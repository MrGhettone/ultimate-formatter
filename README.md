# Ultimate Formatter

Estensione VSCode che fornisce un formattatore custom per **JavaScript** e **PHP**, pensato per uno stile di codice specifico (stile Allman, con graffe sempre a capo) e per normalizzare automaticamente i pattern più comuni usati con jQuery e PHP/MySQL.

Include inoltre uno snippet pack per accelerare la scrittura di chiamate ajax, cicli, funzioni e boilerplate PHP.

## Come si usa

Una volta installata, l'estensione si registra come formattatore di default per i file `.js` e `.php` (vedi `configurationDefaults` in `package.json`). Basta quindi usare **Format Document** (`Shift+Alt+F`) o l'opzione "Format on Save" di VSCode.

## Cosa fa il formatter

### Regole generali (JS e PHP)

- **Stile Allman**: le graffe `{` vanno sempre a capo rispetto all'istruzione che le apre.
  ```js
  // prima
  function foo() {
      ...
  }

  // dopo
  function foo()
  {
      ...
  }
  ```
- **`} else` / `} else if`** vengono separati su righe distinte.
- **`if` / `else if` senza graffe**: se condizione e corpo sono sulla stessa riga, vengono spezzati su due righe con indentazione corretta.
  ```php
  // prima
  if(!empty($_REQUEST['who'])) $tipo = $_REQUEST['who'];

  // dopo
  if(!empty($_REQUEST['who']))
      $tipo = $_REQUEST['who'];
  ```
- **Nessuno spazio prima delle parentesi tonde** (`if(`, `for(`, `foo(`...), tranne dopo gli operatori `&&` / `||`, dove lo spazio viene preservato.
- **Virgole**: uno spazio dopo ogni virgola, nessuno spazio prima — applicato in modo coerente a tutti gli argomenti di una chiamata/dichiarazione, non solo al primo.
- **Punto e virgola multipli sulla stessa riga** vengono separati su righe distinte.
- **Le stringhe letterali non vengono mai alterate**: il contenuto tra apici/virgolette (es. una query SQL con le sue virgole e parentesi) resta intatto, qualunque sia la formattazione applicata al resto della riga.
- **I commenti `//`** vengono normalizzati con uno spazio dopo (`//commento` → `// commento`), senza toccare i `://` degli URL.
- L'indentazione usa **4 spazi** (i tab vengono convertiti automaticamente).

### JavaScript

- **Dichiarazioni `var` / `let` / `const`** con più variabili sulla stessa riga vengono spezzate una per riga, con le righe successive indentate di un livello in più:
  ```js
  // prima
  var a = 1, b = 2, c = 3;

  // dopo
  var a = 1,
      b = 2,
      c = 3;
  ```
- **Blocchi `$.ajax({...})`**: le opzioni vengono riformattate una per riga, comprese le proprietà con oggetti annidati (es. `data: {...}`), aprendo e chiudendo le graffe su righe proprie.
- **Chaining `.done()` / `.then()` / `.fail()`**: restano attaccati alla `})` di chiusura del blocco precedente, con la stessa graffa di apertura sulla riga (`}).done(function(response) {`), mantenendo compatta e leggibile l'intera catena ajax.
  ```js
  $.ajax({
      url: url,
      data: {
          request: "codif",
          param: valore
      }
  }).done(function(response) {
      ...
  }).fail(function(response) {
      return_fail(response);
  });
  ```

### PHP

- **Array associativi** (sia `array(...)` che `[...]`) con `=>` vengono formattati con una coppia chiave => valore per riga:
  ```php
  // prima
  $r = array("msg"=>"Ok","query"=>$q, "record_set"=>$rs);

  // dopo
  $r = array(
      "msg"=>"Ok",
      "query"=>$q,
      "record_set"=>$rs
  );
  ```
  Gli array indicizzati e le chiamate a funzione (`array(1,2,3)`) restano invariati.

## Snippet inclusi

L'estensione include snippet dedicati per JS e PHP (visibili in `snippets/javascript.json` e `snippets/php.json`), tra cui:

**JavaScript**: `aj` / `ajp` (chiamate `$.ajax`, normale o con `include_pers`), `$#` / `$.` (selector jQuery per id/classe), `val`, `click`, `on` / `ons`, `func`, `initjs`.

**PHP**: `func`, `for`, `foreach` (con controllo `is_array`), `querys` (query `SELECT` con `DB_query`/`DB_fetch`), `print_r`, `initq` (boilerplate file `_q.php` di backend), `initf` (boilerplate pagina frontend).

## Licenza

MIT
