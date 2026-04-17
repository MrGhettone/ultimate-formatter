const vscode = require("vscode");

function activate(context)
{
    const provider = {
        provideDocumentFormattingEdits(document)
        {
            const original = document.getText();
            const lang = document.languageId; // <--- Prendi il linguaggio qui

            const formatted = formatCode(original,lang);

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
let indentLevel = 0;
// Funzione principale di formattazione, che normalizza il codice e poi chiama funzioni specifiche per ogni linguaggio
function formatCode(code,lang)
{
    const indentUnit = "    "; // 4 spazi
    code = code.replace(/\r\n/g, "\n");

    // 1. Salva i commenti
    const comments = [];
    code = code.replace(/(\/\/.*)/g, (match) => {
        const index = comments.length;
        comments.push(match);
        return `__COMMENT_${index}__`;
    });

    // 2. Applica le tue regex
    code = code.replace(/\(\s*(.*)\s*,\s*(.*)\s*\)/g, "($1,$2)");
    // code = code.replace(/\(\s*([^,\n]+?)\s*,\s*([^\n]+?)\s*\)/g, "($1,$2)");
    code = code.replace(/\)\s*{/g, ")\n{");
    // code = code.replace(/\)[ \t]*{/g, ")\n{");
    code = code.replace(/{\s*"/g, "{\"");
    code = code.replace(/}\s*else\s*{/g, "}\nelse\n{");
    // code = code.replace(/{[ \t]*"/g, "{\"");

    // 3. Ripristina i commenti
    code = code.replace(/__COMMENT_(\d+)__/g, (_, i) => comments[i]);

    // 2) Rimuovi spazi nei parametri delle tonde (semplice, NON entra in stringhe/commenti)
    code = code.replace(/\s*\(+/g, "(");

    // 5) Split in righe e sostituisci tab con 4 spazi
    const rawLines = code.split("\n");
    const lines = rawLines.map(l => l.replace(/\t/g, indentUnit));

    let output = [];
    let ivuoti = 0;

    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i];
        var trimmed = line.trim();

        if(!/\/\/\s/.test(trimmed))
            trimmed = trimmed.replace(/\/\//g, "// ");

        // identifico i commenti e li emetto senza modificarli, in questo modo evito di inserire spazi o newline indesiderati all'interno di commenti che possono essere presenti in linee con codice
        // if(/\/\//.test(trimmed))
        if(trimmed.startsWith("//"))
        {
            output.push(indentUnit.repeat(indentLevel)+trimmed);
            continue;
        }

        // conserva linee vuote
        // if(trimmed === "")
        // {
        //     ivuoti++;
        //     continue;
        // }
        // else if(ivuoti > 0)
        // {
        //     output.push("");
        //     ivuoti = 0;
        // }

        // caso apertura graffa singola: emetti alla indent corrente, poi incrementa
        if (trimmed == "{" || trimmed.endsWith("{"))
        {
            if(/\{\{/.test(trimmed))
            {
                var splitted = trimmed.split("{");
                for(let j = 0; j < splitted.length; j++)
                {
                    indentLevel = Math.max(0, indentLevel - 1);
                    output.push(indentUnit.repeat(indentLevel)+splitted[j]+(j < splitted.length - 1 ? "{" : ""));
                }
            }
            else
            {
                output.push(indentUnit.repeat(indentLevel)+trimmed);
                indentLevel++;
            }
            continue;
        }

        // caso chiusura graffa: decrementa indent prima di emettere
        if (trimmed == "}" || trimmed.startsWith("}"))
        // if (trimmed == "}"){
        {
            if(/\}\}/.test(trimmed))
            {
                var splitted = trimmed.split("}");
                for(let j = 0; j < splitted.length; j++)
                {
                    indentLevel = Math.max(0, indentLevel - 1);
                    output.push(indentUnit.repeat(indentLevel)+splitted[j]+(j < splitted.length - 1 ? "}" : ""));
                }
            }
            else
            {
                indentLevel = Math.max(0, indentLevel - 1);
                output.push(indentUnit.repeat(indentLevel)+trimmed);
            }
            continue;
        }

        if(trimmed != "{" && trimmed.startsWith("{") && !/\{.*\s*"/.test(trimmed) && !/\{.*\s*'/.test(trimmed))
        {
            indentLevel++;
            trimmed = trimmed.replace(/{(.*)/g, "{\n"+indentUnit.repeat(indentLevel)+"$1");
        }

        if(trimmed != "}" && trimmed.endsWith("}") && !/\}.*\s*"/.test(trimmed) && !/\}.*\s*'/.test(trimmed))
        {
            indentLevel = Math.max(0, indentLevel - 1);
            trimmed = trimmed.replace(/(.*)}/g, "$1\n"+indentUnit.repeat(indentLevel)+"}");
        }

        trimmed = splitSemicolonsOutsideStrings(trimmed,indentLevel);

        // if(/;\s*(.*\()/.test(trimmed))
        // {
        //     trimmed = trimmed.replace(/;\s*(.*\()/g, ";\n"+indentUnit.repeat(indentLevel)+"$1");
        // }
        // riga normale: emetti alla indent corrente
        const prev = lines[i - 1]?.trim();

        const isControl =
            /^(if|for|while|else if)\b.*\)$/.test(prev) ||
            /^else$/.test(prev);

        if (
            trimmed !== '{' &&
            !trimmed.startsWith("{") &&
            !trimmed.endsWith("{") &&
            isControl
        ) {
            output.push(indentUnit.repeat(indentLevel + 1) + trimmed);
        } else {
            output.push(indentUnit.repeat(indentLevel) + trimmed);
        }
    }

    switch(lang)
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
    // output = output.join("\n").replace(/;(.*)\("/g, ";\n").split("\n");


    return output.join("\n");
}

// Funzione per separare i  solo fuori da stringhe
function splitSemicolonsOutsideStrings(line,indentLevel)
{
    let result = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    const indentUnit = "    "; // 4 spazi

    for (let i = 0; i < line.length; i++)
    {
        const char = line[i];

        if(char === "'" && !inDoubleQuote)
            inSingleQuote = !inSingleQuote;
        else if(char === '"' && !inSingleQuote)
            inDoubleQuote = !inDoubleQuote;

        if(char == ';' && inSingleQuote)
            console.log(line, inSingleQuote);

        if(char === '+' && !inSingleQuote && !inDoubleQuote)
            result += '++'; // segnaposto doppio per split successivo
        else if(char === '=' && !inSingleQuote && !inDoubleQuote)
            result += '=='; // segnaposto doppio per split successivo
        else if(char === ';' && !inSingleQuote && !inDoubleQuote && !/\/.*;.*\//.test(line) && !/.*;\s*\/\//.test(line) && !/\(.*;.*\)/.test(line) && i < line.length - 1)
            result += ';;'; // segnaposto doppio per split successivo
        else
            result += char;
    }

    // sostituisci doppio ; con ; + newline
    result = result.replace(/ \+\+==/g, '+=');
    result = result.replace(/ \+\+ /g, '+');
    result = result.replace(/\+\+ /g, '+');
    result = result.replace(/ \+\+/g, '+');
    result = result.replace(/\+\+/g, '+');
    result = result.replace(/==/g, '=');
    if(!/'.*;;.*'/.test(result) && !/".*;;.*"/.test(result) && !/\/.*;;.*\//.test(result))
        result = result.replace(/;;/g, ';\n'+indentUnit.repeat(indentLevel));

    return result;
}

// Regola per mettere newline dopo chiamate a funzioni (es. .then() { ) e dopo dichiarazioni di funzioni (es. function() { )
function formatJs(lines)
{
    let inSingleQuote = false,
        inAjax = false,
        inDoubleQuote = false,
        temp = [];
    const indentUnit = "    "; // 4 spazi
    const comments = [];

    lines = lines.join("\n");

    // 1. Salva i commenti
    lines = lines.replace(/(\/\/.*)/g, (match) => {
        const index = comments.length;
        comments.push(match);
        return `__COMMENT_${index}__`;
    });

    // indenta le ajax correttamente con lo then o done dopo la tonda e allinea il function alla indentazione corretta
    lines = lines.replace(/\)\s*\.(.*)\((.*?)\)\s*{/g, ").$1($2) {");
    // lines = lines.replace(/\)[ \t]*\.([^\(\n]+)\(([^\n]*?)\)[ \t]*{/g, ").$1($2) {");
    lines = lines.replace(/function\((.*?)\)\s*{/g, "function($1) {");
    // lines = lines.replace(/function\(([^\n]*?)\)[ \t]*{/g, "function($1) {");

    // // 3. Ripristina i commenti
    lines = lines.replace(/__COMMENT_(\d+)__/g, (_, i) => comments[i]);

    lines = lines.split("\n");
    // coclo per identificare l'intestazione di una chiamata ajax e indentare tutto il blocco fino alla chiusura del function associato, tenendo conto di eventuali stringhe che possono contenere graffe o parentesi
    for (let j = 0; j < lines.length; j++)
    {
        const line = lines[j];
        var result = '';

        if(line.trim() == "$.ajax({" && !inAjax)
        {
            inAjax = true;
            result = line;
            indentLevel = Math.floor(line.indexOf("$.ajax({") / indentUnit.length) + 1;
        }
        else if(inAjax && (/function\(.*\)\s*\{/.test(line.trim())))
        {
            inAjax = false;
            indentLevel = Math.max(0, indentLevel - 1);
            indentLevel = Math.max(0, indentLevel - 1);
            result = indentUnit.repeat(indentLevel)+line;
            indentLevel = Math.max(0, indentLevel - 1);
        }
        else if (inAjax)
        {
            for (let i = 0; i < line.length; i++)
            {
                const char = line[i];
                // identifico se sono dentro una stringa per evitare di contare graffe o parentesi che possono essere presenti in stringhe
                if(char === "'" && !inDoubleQuote)
                    inSingleQuote = !inSingleQuote;
                else if(char === '"' && !inSingleQuote)
                    inDoubleQuote = !inDoubleQuote;
                // se non sono dentro una stringa, conto le graffe per identificare la fine del blocco ajax/ oggetto data e indentare correttamente
                if(char === '{' && !inSingleQuote && !inDoubleQuote)
                {
                    result += '{';
                    indentLevel++;
                }
                else if(char === '}' && !inSingleQuote && !inDoubleQuote)
                {
                    indentLevel = Math.max(0, indentLevel - 1);
                    result += '}';
                }
                // se sono presenti , vado a capo solamente se quest'ultima non è l'ultima del blocco (es. non è seguita da } o ) e non sono dentro una stringa, in questo modo evito di mettere newline dopo l'ultima proprietà di un oggetto o dopo l'ultimo parametro di una funzione
                else if(char === ',' && i < line.length - 1 && !inSingleQuote && !inDoubleQuote)
                {
                    result += ',\n'+indentUnit.repeat(indentLevel);
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
    // for(let i = 0; i < lines.length; i++)
    // {

    // }

    return lines;
}