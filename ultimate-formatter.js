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

    // 2. Normalizzazione: usa regex non-greedy per evitare match errati su righe con più funzioni
    code = code.replace(/\(\s*([^,\n]+?)\s*,\s*([^\n]+?)\s*\)/g, "($1,$2)");
    code = code.replace(/\)\s*{/g, ")\n{");
    code = code.replace(/{\s*"/g, "{\"");
    // Separa } else if su righe distinte (Allman style)
    code = code.replace(/}\s*else\s+if\b/g, "}\nelse if");
    code = code.replace(/}\s*else\s*{/g, "}\nelse\n{");

    // 3. Ripristina i commenti
    code = code.replace(/__COMMENT_(\d+)__/g, (_, i) => comments[i]);

    // 4. Rimuovi spazi prima di ( — FIX: era \(+ che consumava anche parentesi annidate
    code = code.replace(/\s*\(/g, "(");

    // 5. Split in righe e sostituisci tab con 4 spazi
    const rawLines = code.split("\n");
    const lines = rawLines.map(l => l.replace(/\t/g, indentUnit));

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
        if (trimmed.startsWith("{") && !/\{.*["']/.test(trimmed))
        {
            indentLevel++;
            trimmed = trimmed.replace(/{(.*)/, "{\n" + indentUnit.repeat(indentLevel) + "$1");
        }

        // Riga con } finale (non isolato): decrementa e split
        if (trimmed.endsWith("}") && !/["'].*\}/.test(trimmed))
        {
            indentLevel = Math.max(0, indentLevel - 1);
            trimmed = trimmed.replace(/(.*)}/, "$1\n" + indentUnit.repeat(indentLevel) + "}");
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
//  Formattazione specifica JavaScript
// ---------------------------------------------------------
function formatJs(lines)
{
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick    = false; // FIX: aggiunto tracking backtick
    let inAjax = false;
    let ajaxBaseLevel = 0; // livello di indentazione di $.ajax({ — usato per allineare .done/.fail
    let temp = [];
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

    for (let j = 0; j < lines.length; j++)
    {
        const line = lines[j];
        let result = '';

        if (line.trim() === "$.ajax({" && !inAjax)
        {
            inAjax = true;
            result = line;
            ajaxBaseLevel = Math.floor(line.indexOf("$.ajax({") / indentUnit.length);
            indentLevel   = ajaxBaseLevel + 1;
        }
        else if (inAjax && /function\(.*\)\s*\{/.test(line.trim()))
        {
            // FIX: usare ajaxBaseLevel invece di 3 decrementi fissi.
            // I decrementi fissi portavano .done a livello 0 indipendentemente
            // da dove si trovava $.ajax({, mentre .fail usava l'output di
            // formatCode (corretto) — causando il disallineamento visibile.
            inAjax = false;
            result = indentUnit.repeat(ajaxBaseLevel) + line.trim();
        }
        else if (inAjax)
        {
            for (let i = 0; i < line.length; i++)
            {
                const char = line[i];
                const prev = i > 0 ? line[i - 1] : '';

                // FIX: aggiunto backtick e controllo escape nel tracking stringhe ajax
                if      (char === "'" && !inDoubleQuote && !inBacktick && prev !== '\\')
                    inSingleQuote = !inSingleQuote;
                else if (char === '"' && !inSingleQuote && !inBacktick && prev !== '\\')
                    inDoubleQuote = !inDoubleQuote;
                else if (char === '`' && !inSingleQuote && !inDoubleQuote)
                    inBacktick = !inBacktick;

                if (char === '{' && !inSingleQuote && !inDoubleQuote && !inBacktick)
                {
                    result += '{';
                    indentLevel++;
                }
                else if (char === '}' && !inSingleQuote && !inDoubleQuote && !inBacktick)
                {
                    indentLevel = Math.max(0, indentLevel - 1);
                    result += '}';
                }
                else if (char === ',' && i < line.length - 1 && !inSingleQuote && !inDoubleQuote && !inBacktick)
                {
                    result += ',\n' + indentUnit.repeat(indentLevel);
                }
                else
                    result += char;
            }
        }
        else
        {
            result = line;
            indentLevel = 0;
        }

        temp.push(result);
    }

    return temp;
}

function formatPhp(lines)
{
    return lines;
}
