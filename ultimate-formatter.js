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
function formatCode(code,lang)
{
    const indentUnit = "    "; // 4 spazi

    // 1) Normalizza newline
    code = code.replace(/\r\n/g, "\n");

    // 2) Rimuovi spazi nei parametri delle tonde (semplice, NON entra in stringhe/commenti)
    code = code.replace(/\s*\(+/g, "(");
    code = code.replace(/\(\s+/g, "(");
    code = code.replace(/\s+\)/g, ")");
    code = code.replace(/,\s+/g, ",");

    // 3) Metti le graffe su linee separate:
    //    - metti newline prima/dopo '{' e '}' quando sono attaccate ad altro codice
    //    - usiamo pattern globali
    code = code.replace(/\s*\{\s*/g, "\n{\n");
    code = code.replace(/\s*\}\s*/g, "\n}\n");

    // 4) Riduci sequenze di newline multiple a massimo 2
    code = code.replace(/\n{3,}/g, "\n\n");
    // code = code.replace(/;/g, ';\n');

    // 5) Split in righe e sostituisci tab con 4 spazi
    const rawLines = code.split("\n");
    const lines = rawLines.map(l => l.replace(/\t/g, indentUnit));

    let indentLevel = 0;
    let output = [];
    let ivuoti = 0;

    for (let i = 0; i < lines.length; i++)
    {
        const raw = lines[i];
        var trimmed = raw.trim();

        // conserva linee vuote
        if (trimmed === "" && ivuoti == 0)
        {
            if (lines[i + 1] !== "}" && lines[i - 1] !== "{")
            {
                // output.push("");
                ivuoti = 0;
            }
            continue;
        }


        // caso chiusura graffa: decrementa indent prima di emettere
        if (trimmed === "}") {
            indentLevel = Math.max(0, indentLevel - 1);
            output.push(indentUnit.repeat(indentLevel) + "}");
            continue;
        }

        // caso apertura graffa singola: emetti alla indent corrente, poi incrementa
        if (trimmed === "{") {
            output.push(indentUnit.repeat(indentLevel) + "{");
            indentLevel++;
            continue;
        }

        trimmed = splitSemicolonsOutsideStrings(trimmed,indentLevel);

        // riga normale: emetti alla indent corrente
        output.push(indentUnit.repeat(indentLevel) + trimmed);
    }

    switch(lang)
    {
        case "javascript":
        {
            output = formatJs(output);
        }
        case "php":
        {
            output = formatPhp(output);
        }
    }

    output = output.join("\n").replace(/<\?php(.*);\s*\?>/g, "<?php$1; ?>").split("\n");

    // join e assicurati newline finale come nell'originale (non obbligatorio)
    return output.join("\n");
}

// Funzione per separare i ; solo fuori da stringhe
function splitSemicolonsOutsideStrings(line,indentLevel)
{
    let result = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inObject = false;
    const indentUnit = "    "; // 4 spazi

    for (let i = 0; i < line.length; i++)
    {
        const char = line[i];
        if(char === "'" && !inDoubleQuote)
        {
            inSingleQuote = !inSingleQuote;
        }
        else if(char === '"' && !inSingleQuote)
        {
            inDoubleQuote = !inDoubleQuote;
        }

        if(char === '+' && !inSingleQuote && !inDoubleQuote)
        {
            result += '++'; // segnaposto doppio per split successivo
        }
        else if(char === '=' && !inSingleQuote && !inDoubleQuote)
        {
            result += '=='; // segnaposto doppio per split successivo
        }
        else if(char === ';' && !inSingleQuote && !inDoubleQuote)
        {
            result += ';;'; // segnaposto doppio per split successivo
        }
        else
        {
            result += char;
        }
    }

    // sostituisci doppio ; con ; + newline
    result = result.replace(/ \+\+==/g, '+=');
    result = result.replace(/ \+\+ /g, '+');
    result = result.replace(/\+\+/g, '+');
    result = result.replace(/==/g, '=');
    result = result.replace(/;{2,} (.*)/g, ';\n'+indentUnit.repeat(indentLevel)+'$1');
    // result = result.replace(/(;{2,})(?!\n)\s*/g, ';\n' + indentUnit.repeat(indentLevel));
    result = result.replace(/;{2,}/g, ';');

    return result;
}

function formatJs(lines)
{
    let inSingleQuote = false;
    let inAjax = false;
    let inGraf = false;
    let inDoubleQuote = false;
    let indentLevel = 0;
    const indentUnit = "    "; // 4 spazi
    var temp = [];

    lines = lines.join("\n")

    lines = lines.replace(/}\s*\)\s*\.(done|fail)/g, "}).$1")

    lines = lines.replace(/\.ajax\(\s*{/g, ".ajax({");

    lines = lines.replace(/:\s*{/g, ":{");

    lines = lines.replace(/}\s*\)/g, "})");

    lines = lines.replace(/\)\s*\.(done|fail)\((.*?)\)\s*{/g, ").$1($2) {");

    lines = lines.split("\n");

    for (let j = 0; j < lines.length; j++)
    {
        const line = lines[j];
        var result = '';

        if(line.trim() === "$.ajax({")
        {
            inAjax = true;
            result = line;
            indentLevel = Math.floor(line.indexOf("$.ajax({") / indentUnit.length) + 1;
        }
        else if(inAjax && line.trim() === "}).done(function(data) {")
        {
            inAjax = false;
            result = line;
        }
        else if (inAjax)
        {
            for (let i = 0; i < line.length; i++)
            {
                const char = line[i];
                if(char === "'" && !inDoubleQuote)
                {
                    inSingleQuote = !inSingleQuote;
                }
                else if(char === '"' && !inSingleQuote)
                {
                    inDoubleQuote = !inDoubleQuote;
                }

                if(char === '{' && !inSingleQuote && !inDoubleQuote)
                {
                    result += '{'; // segnaposto doppio per split successivo
                    inGraf = true;
                    indentLevel++;
                }
                else if(char === '}' && !inSingleQuote && !inDoubleQuote)
                {
                    result += '}'; // segnaposto doppio per split successivo
                    inGraf = false;
                    indentLevel--;
                }
                else if(char === ',' && !inSingleQuote && !inDoubleQuote)
                {
                    result += ',\n'+indentUnit.repeat(indentLevel); // segnaposto doppio per split successivo
                }
                else
                {
                    result += char;
                }
            }
        }
        else
        {
            result = line;
        }


        temp.push(result);
    }

    lines = lines.join("\n")
    lines = lines.split("\n")

    return temp;
}

function formatPhp(lines)
{
    // for(let i = 0; i < lines.length; i++)
    // {

    // }

    return lines;
}