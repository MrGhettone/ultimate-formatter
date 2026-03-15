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

function formatCode(code,lang)
{
    const indentUnit = "    "; // 4 spazi
    // console.log(code)
    // 1) Normalizza newline
    code = code.replace(/\r\n/g, "\n");
    code = code.replace(/\(\s*(.*)\s*,\s*(.*)\s*\)/g, "($1,$2)");
    // if(!/".*\)\s*{.*"/.test(code) && !/'.*\)\s*{.*'/.test(code))
    code = code.replace(/\)\s*{/g, ")\n{");
    code = code.replace(/{\s*"/g, "{\"");


    // 2) Rimuovi spazi nei parametri delle tonde (semplice, NON entra in stringhe/commenti)
    // code = code.replace(/\s*\(+/g, "(");
    // code = code.replace(/\(\s+/g, "(");
    // code = code.replace(/\s+\)/g, ")");

    // 3) Metti le graffe su linee separate:
    //    - metti newline prima/dopo '{' e '}' quando sono attaccate ad altro codice
    //    - usiamo pattern globali
    // code = code.replace(/\s*\{\s*/g, "\n{\n");
    // code = code.replace(/\s*\}\s*/g, "\n}\n");

    // code = code.replace(/\/(.*)\s*\}\s*(.*)\/g/g, "/$1}$2/g");
    // code = code.replace(/\/(.*)\s*\{\s*(.*)\/g/g, "/$1{$2/g");
    // code = code.replace(/"(.*)\s*\}\s*(.*)"/g, "\"$1}$2\"");
    // code = code.replace(/"(.*)\s*\{\s*(.*)"/g, "\"$1{$2\"");

    // 4) Riduci sequenze di newline multiple a massimo 2
    // code = code.replace(/\n{3,}/g, "\n");
    // code = code.replace(/;/g, ';\n');

    // 5) Split in righe e sostituisci tab con 4 spazi
    const rawLines = code.split("\n");
    const lines = rawLines.map(l => l.replace(/\t/g, indentUnit));

    let output = [];
    let ivuoti = 0;

    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i];
        var trimmed = line.trim();

        if(/\/\//.test(line))
        {
            if(!/\/\/\s/.test(line))
                trimmed = trimmed.replace(/\/\//g, "// ");
            output.push(indentUnit.repeat(indentLevel)+trimmed);
            continue;
        }

        // conserva linee vuote
        if(trimmed === "")
        {
            ivuoti++;
            continue;
        }
        else if(ivuoti > 0)
        {
            output.push("");
            ivuoti = 0;
        }

        // caso apertura graffa singola: emetti alla indent corrente, poi incrementa
        if (trimmed == "{" || trimmed.endsWith("{")){
            output.push(indentUnit.repeat(indentLevel)+trimmed);
            indentLevel++;
            continue;
        }

        if(trimmed != "{" && trimmed.startsWith("{") && (!/\{.*"/.test(trimmed || !/\{.*'/.test(trimmed))))
        {
            indentLevel++;
            trimmed = trimmed.replace(/{(.*)/g, "{\n"+indentUnit.repeat(indentLevel)+"$1");
        }

        if(trimmed != "}" && trimmed.endsWith("}"))
        {
            // indentLevel = Math.max(0, indentLevel - 1);
            indentLevel = Math.max(0, indentLevel - 1);
            trimmed = trimmed.replace(/(.*)}/g, "$1\n"+indentUnit.repeat(indentLevel)+"}");
        }

        // caso chiusura graffa: decrementa indent prima di emettere
        if (trimmed == "}" || trimmed.startsWith("}")){
        // if (trimmed == "}"){
            indentLevel = Math.max(0, indentLevel - 1);
            output.push(indentUnit.repeat(indentLevel)+trimmed);
            // indentLevel--;
            continue;
        }

        trimmed = splitSemicolonsOutsideStrings(trimmed,indentLevel);

        // riga normale: emetti alla indent corrente
        if(lines[i - 1].endsWith(")") && trimmed != '{' && !trimmed.startsWith("{") && !trimmed.endsWith("{"))
            output.push(indentUnit.repeat(indentLevel + 1) + trimmed);
        else
            output.push(indentUnit.repeat(indentLevel) + trimmed);
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

        // if(char === '.' && !inSingleQuote && !inDoubleQuote)
        //     result += '..'; // segnaposto doppio per split successivo
        if(char === '+' && !inSingleQuote && !inDoubleQuote)
            result += '++'; // segnaposto doppio per split successivo
        else if(char === '=' && !inSingleQuote && !inDoubleQuote)
            result += '=='; // segnaposto doppio per split successivo
        else if(char === ';' && !inSingleQuote && !inDoubleQuote && !/\/.*;.*\//.test(line) && i < line.length - 1)
            result += ';;'; // segnaposto doppio per split successivo
        else
            result += char;
    }

    // sostituisci doppio ; con ; + newline
    // result = result.replace(/ \.\.==/g, '.=');
    result = result.replace(/ \+\+==/g, '+=');
    result = result.replace(/ \+\+ /g, '+');
    // result = result.replace(/ \.\. /g, '.');
    result = result.replace(/\+\+ /g, '+');
    // result = result.replace(/\.\. /g, '.');
    result = result.replace(/ \+\+/g, '+');
    // result = result.replace(/ \.\./g, '.');
    result = result.replace(/\+\+/g, '+');
    // if(/(.*)\.\.(.*)/g.test(result))
    // {
    //     console.log(result);
    //     result = result.replace(/(.*)\.\.(.*)/g, '$1.$2');
    //     console.log(result);
    // }
    result = result.replace(/==/g, '=');
    result = result.replace(/;;\s*/g, ';\n'+indentUnit.repeat(indentLevel));
    return result;
}

function formatJs(lines)
{
    let inSingleQuote = false;
    let inAjax = false;
    let inGraf = false;
    let inReg = false;
    let inDoubleQuote = false;

    const indentUnit = "    "; // 4 spazi
    var temp = [];

    // lines = lines.join("\n")

    // lines = lines.replace(/}\s*\)\s*\.(.*)/g, "}).$1")

    // lines = lines.replace(/\$\.ajax\(\s*{/g, "\$.ajax({");

    // lines = lines.replace(/:\s*{/g, ":{");

    // lines = lines.replace(/}\s*\)/g, "})");
    // if(!/\)\.\$1\(\$2\) \{\"/.test(lines))
    lines = lines.join("\n").replace(/\)\s*\.(.*)\((.*?)\)\s*{/g, ").$1($2) {").split("\n");
    lines = lines.join("\n").replace(/function\((.*?)\)\s*{/g, "function($1) {").split("\n");
    // if(!/function($1) {"/.test(lines))
        // lines = lines.replace(/function\((.*?)\)\s*{/g, "function($1) {");
    // lines = lines.replace(/{\s*"/g, "{\"");

    // lines = lines.replace(/\/\s*(.*)\s*(.*)\s*(.*)\//g, "/$1$2$3{/");

    // lines = lines.replace(/"\s*(.*)\s*"\);/g, "\"$1\");");
    // lines = lines.replace(/{\s*"/g, "{\"");

    // lines = lines.split("\n");

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
            // if(lines[j - 1].trim().endsWith("{"))
            //     result+= indentUnit.repeat(indentLevel - 1);
            for (let i = 0; i < line.length; i++)
            {
                // var inComment = line.trim().startsWith("//");
                const char = line[i];
                // if(char == ',')
                //     console.log(char, inSingleQuote, inDoubleQuote, inGraf, inReg);

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
                    result += '{';
                    // inGraf = true;
                    indentLevel++;
                }
                else if(char === '}' && !inSingleQuote && !inDoubleQuote)
                {
                    indentLevel = Math.max(0, indentLevel - 1);
                    // indentLevel--;
                    // result += indentUnit.repeat(indentLevel)+'}';
                    result += '}';
                    // inGraf = false;
                }
                else if(char === ',' && !inSingleQuote && !inDoubleQuote)
                {
                    result += ',\n'+indentUnit.repeat(indentLevel);
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
            indentLevel = 0;
        }
        temp.push(result);

        // temp = temp.join("\n")

        // temp = temp.replace(/,,/g, ",");

        // temp = temp.replace(/"\s*(.*)\s*"\);/g, "\"$1\");");

        // temp = temp.split("\n");

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