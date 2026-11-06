# Fantropico

Fantropico è una web app che risponde alle domande sul regolamento di una lega di fantacalcio.
L'admin crea la lega, carica il regolamento e inserisce la propria chiave API di Anthropic. I partecipanti entrano con un link o un codice e fanno domande dallo smartphone.
Il bot risponde solo in base al regolamento della lega e cita l'articolo. Se l'admin la attiva, può anche dare un parere sulla sostituzione di un giocatore infortunato.

Fantropico non è affiliato ad Anthropic.

## Struttura del progetto

```
fantropico/
├─ package.json            workspace npm (web e worker)
├─ .nvmrc                  versione di Node (24)
├─ regolamento-esempio.md  regolamento generico per le prove
├─ web/                    sito su Cloudflare Pages (Vite e JavaScript semplice)
└─ worker/                 API su Cloudflare Workers (TypeScript)
   ├─ wrangler.jsonc       binding D1 e KV, ALLOWED_ORIGIN, cron
   ├─ migrations/          schema del database D1
   ├─ src/                 dominio, sicurezza, limiti, modello, rotte
   └─ test/                test con Vitest nel runtime dei Workers
```

## Requisiti

- Node 24. Con nvm basta lanciare `nvm use` nella radice del progetto.
- Un account Cloudflare.
- Una chiave API di Anthropic per ogni lega. Non va nel codice: la inserisce l'admin dal sito quando crea la lega.
- Per la verifica infortuni, la ricerca web deve essere abilitata nella Console Anthropic dell'admin (è attiva di default, ma un amministratore dell'organizzazione può spegnerla).

## Sviluppo locale

Installa le dipendenze dalla radice del progetto:

```bash
nvm use
```

```bash
npm install
```

Crea il file dei secret locali del Worker partendo dall'esempio. Il file `worker/.dev.vars` è ignorato da git.

```bash
cp worker/.dev.vars.example worker/.dev.vars
```

Genera un valore per `SESSION_SECRET` e uno per `ENCRYPTION_KEY` e incollali in `worker/.dev.vars`. Lascia `ALLOWED_ORIGIN=http://localhost:5173`, l'indirizzo di Vite in locale.

```bash
openssl rand -base64 32
```

Applica le migrazioni al database D1 locale:

```bash
npm run db:migrate:local -w worker
```

Avvia il Worker (risponde su `http://localhost:8787`):

```bash
npm run dev:worker
```

Crea `web/.env.local` (ignorato da git) partendo dall'esempio, che punta al Worker locale:

```bash
cp web/.env.example web/.env.local
```

In un altro terminale avvia il sito (risponde su `http://localhost:5173`):

```bash
npm run dev:web
```

Test e controllo dei tipi:

```bash
npm test
```

Controllo dei tipi (genera prima `worker/worker-configuration.d.ts`, che è ignorato da git):

```bash
npm run typecheck
```

## Deploy passo passo

I comandi `npx wrangler` vanno lanciati dentro la cartella `worker`. Gli script npm si lanciano dalla radice con `-w worker`.

### 1. Worker, database e secret

Entra nella cartella del Worker:

```bash
cd worker
```

Accedi a Cloudflare:

```bash
npx wrangler login
```

Crea il database D1. Copia il `database_id` stampato nel campo `database_id` di `worker/wrangler.jsonc`.

```bash
npx wrangler d1 create fantropico
```

Crea il namespace KV per i freni anti-abuso. Copia l'`id` stampato nel campo `id` del binding `ABUSE_KV` in `worker/wrangler.jsonc`.

```bash
npx wrangler kv namespace create ABUSE_KV
```

Genera due valori diversi, uno per ogni secret:

```bash
openssl rand -base64 32
```

Salva il primo come `SESSION_SECRET`:

```bash
npx wrangler secret put SESSION_SECRET
```

Salva il secondo come `ENCRYPTION_KEY`:

```bash
npx wrangler secret put ENCRYPTION_KEY
```

Conserva `ENCRYPTION_KEY` in un posto sicuro. Se la perdi o la cambi, le chiavi API salvate non si possono più leggere e ogni admin dovrà reinserire la propria. Se cambi `SESSION_SECRET`, tutti dovranno rientrare nella lega.

In `worker/wrangler.jsonc` imposta `ALLOWED_ORIGIN` con l'indirizzo del sito su Pages, per esempio `https://fantropico.pages.dev`.

Torna nella radice del progetto:

```bash
cd ..
```

Applica le migrazioni al database remoto:

```bash
npm run db:migrate:remote -w worker
```

Pubblica il Worker. Annota l'indirizzo stampato, per esempio `https://fantropico-api.<account>.workers.dev`.

```bash
npm run deploy -w worker
```

### 2. Sito su Cloudflare Pages

1. Carica il progetto su un repository GitHub privato. I file `.dev.vars` e `.env` sono già esclusi da `.gitignore`.
2. Nella dashboard di Cloudflare crea un progetto Pages collegato a quel repository.
3. Impostazioni di build:
   - Framework preset: None
   - Root directory: la radice del repository
   - Build command: `npm run build`
   - Build output directory: `web/dist`
4. Variabili d'ambiente di build:
   - `VITE_API_BASE` con l'indirizzo del Worker, per esempio `https://fantropico-api.<account>.workers.dev`
   - `NODE_VERSION` = `24`, se Pages non legge da solo il file `.nvmrc`
5. Avvia il primo deploy.

Durante la build vengono generati gli header di sicurezza del sito e la Content Security Policy, nel file `web/dist/_headers`, a partire da `VITE_API_BASE`.

### 3. Controllo finale

Dopo il primo deploy del sito controlla che `ALLOWED_ORIGIN` in `worker/wrangler.jsonc` coincida esattamente con l'origin del sito: stesso protocollo e dominio, niente slash finale. Il Worker accetta solo richieste da quell'origin. Se lo hai cambiato, pubblica di nuovo il Worker:

```bash
npm run deploy -w worker
```

## Come creare una lega

1. Apri il sito e scegli "Crea una lega". Inserisci:
   - il nome della lega
   - il tuo nome
   - una password admin di almeno 12 caratteri, che non contenga il nome della lega, il tuo nome o parole come "password" e "fantacalcio"
   - la tua chiave API di Anthropic
   La chiave viene verificata con Anthropic prima di essere salvata.
2. Dal pannello admin carica il regolamento (PDF, DOCX, TXT o Markdown). Il testo viene estratto nel browser: rileggilo, correggi gli errori di estrazione e salvalo. Il massimo è 150.000 caratteri. Puoi aggiornarlo o sostituirlo quando vuoi.
3. Condividi il link d'invito o il codice lega. Il link ha la forma `https://<sito>/#/entra?codice=XXXXXXXX`: il codice sta dopo il `#`, così non arriva nei log del server.
4. I partecipanti entrano scegliendo un nome. Non serve nessuna password.

Se nessuno usa la lega per 60 giorni (nessun accesso di partecipanti o admin), la lega viene cancellata in automatico con tutti i suoi dati: chiave API, regolamento, membri, contatori e registro. Ogni accesso fa ripartire i 60 giorni.

Nel pannello admin puoi anche:

- rimuovere un partecipante. La sua sessione cade subito. Dopo una rimozione conviene rigenerare il codice, altrimenti chi è stato rimosso può rientrare con un altro nome.
- rigenerare il codice lega. Chi è già dentro resta dentro.
- cambiare il limite di domande al giorno, da 1 a 100. Il predefinito è 20 e vale anche per l'admin.
- attivare o spegnere la verifica infortuni.
- sostituire la chiave API. La chiave salvata non viene mai mostrata, solo la data dell'ultimo aggiornamento.
- cambiare la password admin. Le altre sessioni admin cadono.
- vedere quante domande sono state fatte nel mese.

Per entrare come admin da un altro dispositivo usa "Accesso admin" con codice lega e password.

## Come risponde il bot

- Risponde solo in base al regolamento della lega e cita l'articolo su cui si basa.
- Se il regolamento non copre il caso, risponde sempre con la frase fissa "Il regolamento non lo prevede, chiedi all'admin." La frase la scrive l'app, non il modello. Una risposta senza articolo citato, o che cita un articolo assente dal regolamento, viene trattata allo stesso modo.
- Sui casi controversi spiega la regola e ricorda che la decisione finale spetta all'admin.
- Per interpretare il regolamento non usa mai il web.

Verifica infortuni (se l'admin la attiva):

- Si usa dal modulo "Verifica sostituzione", indicando il giocatore infortunato e il sostituto. La ricerca web parte solo da lì.
- Il bot cerca solo su fantacalcio.it e leghe.fantacalcio.it i tempi di recupero dell'infortunato e la quotazione attuale dei due giocatori, poi applica la regola del regolamento.
- La risposta è un parere indicativo con i link alle fonti, la data del controllo e la frase "La conferma finale spetta all'admin."
- Se le informazioni non si trovano o non sono chiare, lo dice e rimanda all'admin.

## Sicurezza in breve

- La chiave API è cifrata con AES-GCM, legata alla lega, e non viene mai restituita al sito né scritta nei log.
- La password admin è salvata come hash PBKDF2-SHA256 con 100.000 iterazioni.
- Le sessioni usano token firmati con HMAC. A ogni richiesta il Worker ricontrolla che il membro sia ancora attivo, quindi una rimozione o un cambio password le revoca subito.
- CORS e controllo dell'Origin accettano solo il dominio del sito.
- Ogni input viene validato per tipo, lunghezza e caratteri ammessi. Gli errori mostrano messaggi fissi e non ripetono mai l'input.
- I limiti giornalieri sono contati in D1 con un aggiornamento atomico. Una domanda viene restituita solo se il modello non ha potuto rispondere per motivi tecnici; un rifiuto o una risposta non valida contano.
- Tentativi di accesso admin: al massimo 5 ogni 15 minuti per IP (anche quelli riusciti) e 50 all'ora per lega, contati in D1 prima di controllare la password, così le richieste in parallelo non aggirano il limite.
- Codici sbagliati e creazione di leghe hanno freni per IP in KV. Gli IP sono salvati solo come hash, e gli IPv6 sono raggruppati per rete (/64).
- Le chiamate al modello hanno un tempo massimo: 45 secondi per una domanda, 120 per una verifica infortuni.
- Domande e risposte non vengono salvate: restano solo i contatori.
- Il registro delle azioni admin non contiene contenuti. Un cron ogni giorno alle 03:00 UTC cancella le leghe inutilizzate da 60 giorni, i contatori giornalieri dopo 7 giorni, i tentativi di accesso dopo un giorno, i membri rimossi dopo 30 giorni e il registro dopo 365 giorni.
- I log automatici delle richieste di Cloudflare sono disattivati: restano solo i log scritti dal codice, che contengono il tipo di evento e mai dati personali o chiavi.
- Per una protezione in più si può aggiungere nella dashboard Cloudflare una regola di rate limiting sulle rotte `/api/join`, `/api/admin/login` e `/api/leagues`.

## Costi e limiti

- Modello: `claude-haiku-5-5`. I prezzi cambiano, verificali sulla pagina prezzi di Anthropic. Il regolamento viene messo in cache tra una domanda e l'altra per ridurre il costo.
- Ricerca web: 10 $ ogni 1.000 ricerche, più i token. Ogni verifica fa al massimo 5 ricerche.
- Tutti i costi del modello vanno sulla chiave API dell'admin della lega.
- Piano gratuito dei Workers: 10 ms di CPU per richiesta. L'hash della password ha misurato circa 5,6 ms in locale. Se in produzione il login admin, la creazione della lega o il cambio password danno errori di CPU, serve il piano Workers Paid (5 $ al mese).

## Test

I test girano con Vitest dentro il runtime dei Workers, con D1 e KV locali. Il modello è sostituito da un `fetch` finto, quindi non partono chiamate reali ad Anthropic.

Coprono:

- primitive di dominio (nomi, codici, domande, regolamento, limiti, chiave API, password)
- cifratura della chiave API
- hash e verifica della password
- token di sessione
- limiti giornalieri e contatore mensile, anche con richieste concorrenti e cambio di giorno all'ora italiana
- freni anti-abuso in KV e tentativi di accesso admin in D1, anche con richieste in parallelo
- accesso con codice, accesso admin, password deboli, revoca delle sessioni, CORS
- controllo degli articoli citati
- domande, verifica infortuni e pannello admin
- modulo del modello e filtro delle fonti

Per lanciarli dalla radice:

```bash
npm test
```
