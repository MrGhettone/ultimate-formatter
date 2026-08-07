const vscode = require("vscode");

function activate(context)
{
    const provider = {
        provideDocumentFormattingEdits(document)
        {
            const original = document.getText();
            const lang = document.languageId;

            const formatted = formatCode(original, lang);

            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(original.length)
            );

            return [vscode.TextEdit.replace(fullRange, formatted)];
        }
    };

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(["javascript", "php"], provider)
    );
}

function deactivate() {}

module.exports = { activate, deactivate };

// ---------------------------------------------------------
//  FORMATTER
// ---------------------------------------------------------

// FIX CRITICO: indentLevel globale, resettato all'inizio di ogni chiamata a formatCode
// per evitare che formattazioni successive partano da un livello sbagliato
let indentLevel = 0;

// Funzione principale di formattazione
function formatCode(code, lang)
{
    indentLevel = 0; // RESET: obbligatorio ad ogni chiamata

    const indentUnit = "    "; // 4 spazi
    code = code.replace(/\r\n/g, "\n");

    // 1. Salva i commenti inline per non alterarli con le regex successive
    const comments = [];
    code = code.replace(/(\/\/.*)/g, (match) => {
        const index = comments.length;
        comments.push(match);
        return `__COMMENT_${index}__`;
    });

    // 1b. Salva le stringhe letterali per non alterarle con le regex di normalizzazione
    // FIX CRITICO: il formatter modificava il contenuto delle stringhe (es. query SQL)
    // rimuovendo spazi o virgole al loro interno — le stringhe vanno protette come i commenti.
    const strings = [];
    code = code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (match) => {
        const index = strings.length;
        strings.push(match);
        return `__STRING_${index}__`;
    });

    // 2. Normalizzazione: usa regex non-greedy per evitare match errati su righe con più funzioni
    // FIX: normalizza TUTTE le virgole di un gruppo di parentesi, non solo la prima
    code = code.replace(/\(([^()\n]*)\)/g, (match, inner) => {
        if (!inner.includes(",")) return match;
        const normalized = inner.split(",").map(p => p.trim()).join(", ");
        return "(" + normalized + ")";
    });
    code = code.replace(/\)\s*{/g, ")\n{");
    code = code.replace(/{\s*"/g, "{\"");
    // Separa } else if su righe distinte (Allman style)
    code = code.replace(/}\s*else\s+if\b/g, "}\nelse if");
    code = code.replace(/}\s*else\s*{/g, "}\nelse\n{");
    // Separa la graffa di chiusura di un blocco quando si trova sulla stessa riga
    // dell'ultima istruzione (es. ".fail(function(x) { foo(); });")
    // FIX: usare [ \t]* invece di \s* — \s* attraversava anche i newline e
    // spezzava blocchi già correttamente su più righe, introducendo righe vuote
    // spurie e rompendo l'idempotenza del formatter.
    code = code.replace(/;[ \t]*}/g, ";\n}");

    // Rimuovi spazi prima di ( — FIX: era \(+ che consumava anche parentesi annidate
    // FIX: non rimuovere lo spazio dopo && / || quando seguiti da una parentesi
    code = code.replace(/(?<!&&)(?<!\|\|)\s*\(/g, "(");

    // 3. Ripristina stringhe e commenti
    code = code.replace(/__STRING_(\d+)__/g, (_, i) => strings[i]);
    code = code.replace(/__COMMENT_(\d+)__/g, (_, i) => comments[i]);

    // 5. Split in righe e sostituisci tab con 4 spazi
    const rawLines = code.split("\n");
    const lines = rawLines
        .map(l => l.replace(/\t/g, indentUnit))
        .flatMap(splitInlineControlBody);

    let output = [];

    // Flag: true quando la riga precedente è stata emessa con +1 di isControl
    // (corpo di if/for/while senza graffe). Serve per allineare il { del blocco
    // figlio allo stesso livello della riga di controllo che lo precede.
    // Esempio:
    //   if(x)
    //       for(...)   ← lastIsControlBody = true dopo questa riga
    //       {          ← { emesso a indentLevel+1, non a indentLevel
    let lastIsControlBody = false;

    // Stack dei livelli in cui applicare un decremento extra dopo il }.
    // Quando un { viene emesso a emitLevel = indentLevel+1 (per lastIsControlBody),
    // indentLevel sale a emitLevel+1. Il } normale lo porta a emitLevel, ma
    // dovrebbe tornare a indentLevel originale. Qui registriamo emitLevel: quando
    // dopo un } indentLevel eguaglia il top dello stack, facciamo un -1 aggiuntivo.
    let controlBodyStack = [];

    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i];
        let trimmed = line.trim();

        // Aggiungi spazio dopo // nei commenti — FIX: lookbehind (?<!:) per non toccare :// nelle URL
        if (!/\/\/\s/.test(trimmed))
            trimmed = trimmed.replace(/(?<!:)\/\//g, "// ");

        // Linee di commento puro: emetti senza modificare indentazione
        if (trimmed.startsWith("//"))
        {
            output.push(indentUnit.repeat(indentLevel) + trimmed);
            lastIsControlBody = false;
            continue;
        }

        // --- APERTURA GRAFFA ---
        if (trimmed === "{" || trimmed.endsWith("{"))
        {
            // FIX: gestione {{ — era sbagliata (usava decrement invece di increment)
            if (/\{.*\{/.test(trimmed))
            {
                const parts = trimmed.split("{");
                for (let j = 0; j < parts.length - 1; j++)
                {
                    output.push(indentUnit.repeat(indentLevel) + parts[j].trim() + "{");
                    indentLevel++;
                }
                const last = parts[parts.length - 1].trim();
                if (last) output.push(indentUnit.repeat(indentLevel) + last);
            }
            else
            {
                // FIX: se la riga precedente era il corpo (senza graffe) di un
                // if/for/while, questo { appartiene a quel corpo ed va allineato
                // al suo stesso livello (indentLevel+1), non a indentLevel.
                // Esempio: if(x) → for(...) → { deve stare al livello del for.
                const emitLevel = lastIsControlBody ? indentLevel + 1 : indentLevel;
                output.push(indentUnit.repeat(emitLevel) + trimmed);
                indentLevel = emitLevel + 1;
                // Registra il livello: dopo il } corrispondente, indentLevel
                // sarà emitLevel (= indentLevel originale + 1). Va decrementato
                // di un'ulteriore unità per tornare al livello pre-if/for/while.
                if (lastIsControlBody) controlBodyStack.push(emitLevel);
            }
            lastIsControlBody = false;
            continue;
        }

        // --- CHIUSURA GRAFFA ---
        if (trimmed === "}" || trimmed.startsWith("}"))
        {
            // FIX: gestione }} — ora simmetrica e corretta
            if (/\}.*\}/.test(trimmed))
            {
                const parts = trimmed.split("}");
                for (let j = 0; j < parts.length - 1; j++)
                {
                    indentLevel = Math.max(0, indentLevel - 1);
                    const fragment = parts[j].trim();
                    output.push(indentUnit.repeat(indentLevel) + fragment + "}");
                }
                const last = parts[parts.length - 1].trim();
                if (last) output.push(indentUnit.repeat(indentLevel) + last);
            }
            else
            {
                indentLevel = Math.max(0, indentLevel - 1);
                output.push(indentUnit.repeat(indentLevel) + trimmed);
                // Decremento extra: se questo } chiude un blocco aperto da un
                // corpo-senza-graffe (if/for/while), ripristina il livello corretto.
                // Il } è già stato emesso al livello giusto (emitLevel); ora
                // portiamo indentLevel al livello del costrutto esterno.
                if (controlBodyStack.length > 0 &&
                    indentLevel === controlBodyStack[controlBodyStack.length - 1])
                {
                    indentLevel = Math.max(0, indentLevel - 1);
                    controlBodyStack.pop();
                }
            }
            lastIsControlBody = false;
            continue;
        }

        // Riga con { iniziale (non isolato): split e incrementa livello
        // FIX: il resto catturato dopo "{" va trimmato, altrimenti lo spazio
        // originale tra "{" e il contenuto si sommava all'indentazione.
        if (trimmed.startsWith("{") && !/\{.*["']/.test(trimmed))
        {
            indentLevel++;
            trimmed = trimmed.replace(/{(.*)/, (_, rest) => "{\n" + indentUnit.repeat(indentLevel) + rest.trim());
        }

        // Riga con } finale (non isolato): decrementa e split
        // FIX: trimma la parte prima di "}" per non lasciare spazi finali
        if (trimmed.endsWith("}") && !/["'].*\}/.test(trimmed))
        {
            indentLevel = Math.max(0, indentLevel - 1);
            trimmed = trimmed.replace(/(.*)}/, (_, before) => before.trim() + "\n" + indentUnit.repeat(indentLevel) + "}");
        }

        trimmed = splitSemicolonsOutsideStrings(trimmed, indentLevel);

        // Indentazione extra per corpo di if/for/while/else senza graffe
        const prev = lines[i - 1]?.trim();
        const isControl =
            /^(if|for|while|else if)\b.*\)$/.test(prev) ||
            /^else$/.test(prev);

        if (
            trimmed !== "{" &&
            !trimmed.startsWith("{") &&
            !trimmed.endsWith("{") &&
            isControl
        )
        {
            output.push(indentUnit.repeat(indentLevel + 1) + trimmed);
            lastIsControlBody = true;
        }
        else
        {
            output.push(indentUnit.repeat(indentLevel) + trimmed);
            lastIsControlBody = false;
        }
    }

    switch (lang)
    {
        case "javascript":
        {
            output = formatJs(output);
            break;
        }
        case "php":
        {
            output = formatPhp(output);
            break;
        }
    }

    output = output.join("\n").replace(/{\s*"/g, "{\"").split("\n");

    return output.join("\n");
}

// ---------------------------------------------------------
//  Trova la parentesi/graffa di chiusura corrispondente a quella aperta in
//  openIndex, ignorando il contenuto di stringhe singole/doppie.
// ---------------------------------------------------------
function findMatchingBracket(str, openIndex, openChar, closeChar)
{
    let depth = 0;
    let inSingle = false, inDouble = false;

    for (let i = openIndex; i < str.length; i++)
    {
        const c = str[i];
        const prev = i > 0 ? str[i - 1] : '';

        if (c === "'" && !inDouble && prev !== '\\')
            inSingle = !inSingle;
        else if (c === '"' && !inSingle && prev !== '\\')
            inDouble = !inDouble;
        else if (!inSingle && !inDouble)
        {
            if (c === openChar) depth++;
            else if (c === closeChar)
            {
                depth--;
                if (depth === 0) return i;
            }
        }
    }

    return -1;
}

// ---------------------------------------------------------
//  Divide una stringa in parti separate da virgole "di primo livello"
//  (fuori da stringhe e da parentesi/graffe annidate)
// ---------------------------------------------------------
function splitTopLevelCommas(str)
{
    const parts = [];
    let depth = 0;
    let inSingle = false, inDouble = false;
    let current = '';

    for (let i = 0; i < str.length; i++)
    {
        const c = str[i];
        const prev = i > 0 ? str[i - 1] : '';

        if (c === "'" && !inDouble && prev !== '\\')
            inSingle = !inSingle;
        else if (c === '"' && !inSingle && prev !== '\\')
            inDouble = !inDouble;

        if (!inSingle && !inDouble && (c === '(' || c === '[' || c === '{'))
            depth++;
        else if (!inSingle && !inDouble && (c === ')' || c === ']' || c === '}'))
            depth--;

        if (c === ',' && depth === 0 && !inSingle && !inDouble)
        {
            parts.push(current);
            current = '';
        }
        else
        {
            current += c;
        }
    }

    if (current.trim() !== '')
        parts.push(current);

    return parts;
}

// ---------------------------------------------------------
//  FIX #11: se il corpo di un if/else if/else senza graffe si trova sulla
//  stessa riga della condizione, spezzalo su due righe così che la logica
//  di indentazione del corpo-senza-graffe (isControl) possa applicarsi.
// ---------------------------------------------------------
function splitInlineControlBody(line)
{
    const leadingWhitespace = (line.match(/^\s*/) || [""])[0];
    const trimmed = line.trim();

    const controlMatch = trimmed.match(/^(if|else if)\s*\(/);
    if (controlMatch)
    {
        const openIndex = trimmed.indexOf("(");
        const closeIndex = findMatchingBracket(trimmed, openIndex, "(", ")");
        if (closeIndex !== -1)
        {
            const rest = trimmed.slice(closeIndex + 1).trim();
            if (rest && !rest.startsWith("{"))
            {
                const head = trimmed.slice(0, closeIndex + 1);
                return [leadingWhitespace + head, leadingWhitespace + rest];
            }
        }
        return [line];
    }

    const elseMatch = trimmed.match(/^else\s+(.+)$/);
    if (elseMatch && !elseMatch[1].startsWith("{"))
        return [leadingWhitespace + "else", leadingWhitespace + elseMatch[1]];

    return [line];
}

// ---------------------------------------------------------
//  Separa i ; fuori da stringhe — versione riscritta
//  FIX CRITICO: rimosso l'encoding fragile di + e = che corrompeva
//  operatori come i++, +=, ==, ===, e template literals
//  FIX: aggiunto tracking dei backtick per template literals
// ---------------------------------------------------------
function splitSemicolonsOutsideStrings(line, indentLevel)
{
    const indentUnit = "    ";

    // Non splittare se il ; è dentro un for(...) o è seguito da un commento inline
    if (/\(.*;.*\)/.test(line) || /.*;\s*\/\//.test(line))
        return line;

    let result = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick  = false;

    for (let i = 0; i < line.length; i++)
    {
        const char = line[i];
        const prev = i > 0 ? line[i - 1] : '';

        // Aggiorna stato stringa — FIX: aggiunto backtick, aggiunto controllo escape
        if      (char === "'" && !inDoubleQuote && !inBacktick && prev !== '\\')
            inSingleQuote = !inSingleQuote;
        else if (char === '"' && !inSingleQuote && !inBacktick && prev !== '\\')
            inDoubleQuote = !inDoubleQuote;
        else if (char === '`' && !inSingleQuote && !inDoubleQuote)
            inBacktick = !inBacktick;

        // Splitta il ; solo se siamo fuori da qualsiasi stringa e non è l'ultimo char
        if (char === ';' && !inSingleQuote && !inDoubleQuote && !inBacktick && i < line.length - 1)
            result += ';\n' + indentUnit.repeat(indentLevel);
        else
            result += char;
    }

    return result;
}

// ---------------------------------------------------------
//  Riformatta il contenuto di un blocco $.ajax({...}) (comprese le
//  eventuali graffe annidate, es. il parametro "data: {...}"): ogni { va a
//  capo, ogni } torna a capo e si disindenta, ogni virgola va a capo.
//  FIX #8: prima le graffe annidate (es. data:{...}) restavano sulla stessa
//  riga delle proprietà invece di andare su righe proprie.
// ---------------------------------------------------------
function reformatAjaxBlock(text, baseLevel, indentUnit)
{
    let normalized = '';
    let inSingleQuote = false, inDoubleQuote = false, inBacktick = false;

    for (let i = 0; i < text.length; i++)
    {
        const c = text[i];
        const prev = i > 0 ? text[i - 1] : '';

        if      (c === "'" && !inDoubleQuote && !inBacktick && prev !== '\\')
            inSingleQuote = !inSingleQuote;
        else if (c === '"' && !inSingleQuote && !inBacktick && prev !== '\\')
            inDoubleQuote = !inDoubleQuote;
        else if (c === '`' && !inSingleQuote && !inDoubleQuote)
            inBacktick = !inBacktick;

        const inString = inSingleQuote || inDoubleQuote || inBacktick;

        if (!inString && c === '{')
            normalized += '{\n';
        else if (!inString && c === '}')
            normalized += '\n}';
        else if (!inString && c === ',')
            normalized += ',\n';
        else
            normalized += c;
    }

    const fragments = normalized.split('\n').map(f => f.trim()).filter(f => f !== '');

    const out = [];
    let level = baseLevel;

    for (const fragment of fragments)
    {
        if (fragment.startsWith('}'))
            level = Math.max(baseLevel - 1, level - 1);

        out.push(indentUnit.repeat(level) + fragment);

        if (fragment.endsWith('{'))
            level++;
    }

    return out;
}

// ---------------------------------------------------------
//  FIX #5: spezza le dichiarazioni var/let/const con più variabili
//  dichiarate sulla stessa riga, una per riga, con le righe successive
//  indentate di un livello in più rispetto alla parola chiave.
// ---------------------------------------------------------
function splitVarDeclaration(trimmed, level, indentUnit)
{
    const match = trimmed.match(/^(var|let|const)\s+([\s\S]*);$/);
    if (!match) return null;

    const keyword = match[1];
    const declList = match[2];

    const parts = splitTopLevelCommas(declList).map(p => p.trim()).filter(p => p !== '');
    if (parts.length <= 1) return null;

    const baseIndent = indentUnit.repeat(level);
    const innerIndent = indentUnit.repeat(level + 1);

    const result = [baseIndent + keyword + " " + parts[0] + ","];
    for (let i = 1; i < parts.length; i++)
    {
        const suffix = i === parts.length - 1 ? ";" : ",";
        result.push(innerIndent + parts[i] + suffix);
    }

    return result;
}

// ---------------------------------------------------------
//  Formattazione specifica JavaScript
// ---------------------------------------------------------
function formatJs(lines)
{
    const indentUnit = "    ";
    const comments = [];

    lines = lines.join("\n");

    // 1. Salva i commenti
    lines = lines.replace(/(\/\/.*)/g, (match) => {
        const index = comments.length;
        comments.push(match);
        return `__COMMENT_${index}__`;
    });

    // Normalizza .then()/.done() e function() { su riga singola
    lines = lines.replace(/\)\s*\.(.*)\((.*?)\)\s*{/g, ").$1($2) {");
    lines = lines.replace(/function\((.*?)\)\s*{/g, "function($1) {");

    // 3. Ripristina i commenti
    lines = lines.replace(/__COMMENT_(\d+)__/g, (_, i) => comments[i]);

    lines = lines.split("\n");

    const temp = [];
    let i = 0;

    while (i < lines.length)
    {
        const line = lines[i];

        if (line.trim() === "$.ajax({")
        {
            // Trova la riga in cui si chiude il blocco $.ajax({...}) tracciando
            // la profondità delle graffe (fuori da stringhe) attraverso le righe.
            const baseLevel = Math.floor((line.match(/^\s*/) || [""])[0].length / indentUnit.length);

            let braceDepth = 1;
            let inSingleQuote = false, inDoubleQuote = false, inBacktick = false;
            const blockLines = [];
            let closeFound = false;
            let chainedRemainder = '';
            let j = i + 1;

            // FIX: la profondità delle graffe va controllata carattere per carattere,
            // non solo a fine riga — righe come "}).done(function(response) {"
            // (chaining sulla stessa riga, comunissimo con $.ajax) chiudono il
            // blocco ajax e ne aprono subito un altro sulla stessa riga: se si
            // controlla solo a fine riga la profondità risulta ancora 1 e il
            // blocco ajax "inghiotte" per errore tutto il codice successivo.
            outer:
            for (; j < lines.length; j++)
            {
                const l = lines[j];

                for (let k = 0; k < l.length; k++)
                {
                    const c = l[k];
                    const prev = k > 0 ? l[k - 1] : '';

                    if      (c === "'" && !inDoubleQuote && !inBacktick && prev !== '\\')
                        inSingleQuote = !inSingleQuote;
                    else if (c === '"' && !inSingleQuote && !inBacktick && prev !== '\\')
                        inDoubleQuote = !inDoubleQuote;
                    else if (c === '`' && !inSingleQuote && !inDoubleQuote)
                        inBacktick = !inBacktick;
                    else if (!inSingleQuote && !inDoubleQuote && !inBacktick)
                    {
                        if (c === '{') braceDepth++;
                        else if (c === '}')
                        {
                            braceDepth--;
                            if (braceDepth === 0)
                            {
                                // La "}" chiude l'oggetto opzioni; subito dopo (a parte
                                // eventuali spazi) c'è la ")" che chiude la chiamata
                                // $.ajax(...) stessa — va inclusa nel blocco, non
                                // scorporata come se fosse codice successivo.
                                let end = k;
                                let m = k + 1;
                                while (m < l.length && /\s/.test(l[m])) m++;
                                if (l[m] === ')')
                                    end = m;

                                blockLines.push(l.slice(0, end + 1));
                                // FIX: un chaining sulla stessa riga (es. "}).done(...) {"
                                // o "}).then(...) {") va tenuto attaccato alla "})" di
                                // chiusura, esattamente come già avviene per ".fail(...)",
                                // invece di essere spostato su una riga a parte.
                                chainedRemainder = l.slice(end + 1).trim();
                                closeFound = true;
                                break outer;
                            }
                        }
                    }
                }

                blockLines.push(l);
            }

            if (!closeFound)
            {
                temp.push(line);
                i++;
                continue;
            }

            const innerText = blockLines.join(" ");
            const formattedInner = reformatAjaxBlock(innerText, baseLevel + 1, indentUnit);

            if (chainedRemainder !== '')
                formattedInner[formattedInner.length - 1] += chainedRemainder;

            temp.push(indentUnit.repeat(baseLevel) + "$.ajax({");
            temp.push(...formattedInner);

            i = j + 1;
            continue;
        }

        const leadingSpaces = (line.match(/^ */) || [""])[0].length;
        const level = Math.floor(leadingSpaces / indentUnit.length);
        const varLines = splitVarDeclaration(line.trim(), level, indentUnit);

        temp.push(...(varLines || [line]));
        i++;
    }

    return temp;
}

// ---------------------------------------------------------
//  FIX #12: formatta gli array associativi PHP (array(...) e [...])
//  con una coppia chiave => valore per riga.
// ---------------------------------------------------------
function splitPhpArrayLiteral(trimmed, level, indentUnit)
{
    const match = trimmed.match(/^(.*?=\s*)(array\(|\[)([\s\S]*)$/);
    if (!match) return null;

    const prefix = match[1];
    const opener = match[2];
    const openChar = opener === "array(" ? "(" : "[";
    const closeChar = openChar === "(" ? ")" : "]";
    const openIndex = prefix.length + opener.length - 1;

    const closeIndex = findMatchingBracket(trimmed, openIndex, openChar, closeChar);
    if (closeIndex === -1) return null;

    const inner = trimmed.slice(openIndex + 1, closeIndex);
    const suffix = trimmed.slice(closeIndex + 1);

    // Formatta solo gli array associativi (contengono =>); gli array indicizzati
    // e le chiamate a funzione restano invariati.
    if (!inner.trim() || !/=>/.test(inner))
        return null;

    const parts = splitTopLevelCommas(inner).map(p => p.trim()).filter(p => p !== '');
    if (parts.length === 0) return null;

    const baseIndent = indentUnit.repeat(level);
    const innerIndent = indentUnit.repeat(level + 1);

    const result = [baseIndent + prefix + opener];
    parts.forEach((part, idx) => {
        const comma = idx < parts.length - 1 ? "," : "";
        result.push(innerIndent + part + comma);
    });
    result.push(baseIndent + closeChar + suffix);

    return result;
}

function formatPhp(lines)
{
    const indentUnit = "    ";
    const result = [];

    for (const line of lines)
    {
        const leadingSpaces = (line.match(/^ */) || [""])[0].length;
        const level = Math.floor(leadingSpaces / indentUnit.length);
        const trimmed = line.trim();

        const arrayLines = splitPhpArrayLiteral(trimmed, level, indentUnit);
        result.push(...(arrayLines || [line]));
    }

    return result;
}
