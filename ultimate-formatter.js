const vscode = require("vscode");

function activate(context) {
    const provider = {
        provideDocumentFormattingEdits(document) {
            const original = document.getText();
            const formatted = formatCode(original);

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

// ---------------------------------------------------------
//  FORMATTER
// ---------------------------------------------------------
function formatCode(code) {
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
    const output = [];
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

    // join e assicurati newline finale come nell'originale (non obbligatorio)
    return output.join("\n");
}

// Funzione per separare i ; solo fuori da stringhe
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
        {
            inSingleQuote = !inSingleQuote;
        }
        else if(char === '"' && !inSingleQuote)
        {
            inDoubleQuote = !inDoubleQuote;
        }
        if(char === '+' && !inSingleQuote && !inDoubleQuote)
        {
            console.log(char);

            result += '++'; // segnaposto doppio per split successivo
        }
        else
        {
            result += char;
        }

        if(char === '=' && !inSingleQuote && !inDoubleQuote)
        {
            console.log(char);

            result += '=='; // segnaposto doppio per split successivo
        }
        else
        {
            result += char;
        }

        if(char === ';' && !inSingleQuote && !inDoubleQuote)
        {
            result += ';;'; // segnaposto doppio per split successivo
        }
        else
        {
            result += char;
        }
    }
    // console.log(result);

    // sostituisci doppio ; con ; + newline
    result = result.replace(/ \+\+==/g, '+=');
    result = result.replace(/ \+\+ /g, '+');
    result = result.replace(/\+\+/g, '+');
    result = result.replace(/==/g, '=');
    result = result.replace(/;; /g, ';\n'+indentUnit.repeat(indentLevel));
    result = result.replace(/;;/g, ';\n'+indentUnit.repeat(indentLevel));

    return result;
}

module.exports = { activate, deactivate };
