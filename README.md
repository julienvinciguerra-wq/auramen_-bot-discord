# auramen bot

Bot Discord open source per logging, moderazione e ticket.

## Requisiti

- Node.js 20.11 o superiore
- Un'applicazione bot creata nel [Discord Developer Portal](https://discord.com/developers/applications)
- Permessi per invitare bot e gestire il server

## Installazione

1. Clona o scarica questo repository.
2. Apri un terminale nella cartella del progetto.
3. Installa le dipendenze:

```bash
npm install
```

4. Copia `.env.example` in `.env`.
5. Inserisci `DISCORD_TOKEN`, `CLIENT_ID` e, per lo sviluppo, `GUILD_ID`.
6. Nel Developer Portal abilita **Server Members Intent** e **Message Content Intent**. Abilita anche gli intent necessari per gli eventi che vuoi registrare.
7. Invita il bot con gli scope `bot` e `applications.commands`, concedendo solo i permessi necessari.
8. Registra i comandi:

```bash
npm run deploy
```

9. Avvia:

```bash
npm start
```

## Comandi disponibili

- `/ping` — verifica che il bot sia online.
- `/setup logs` — assegna un canale a una categoria di log.
- `/setup tickets` — configura canale pannello, archivio transcript e ruolo staff.
- `/setup permessi` — imposta il ruolo e il canale consentiti per ogni comando di moderazione.
- `/setup mostra` — mostra la configurazione salvata.
- `/moderazione warn` — registra un avvertimento (l'utente riceve un DM, se ha i DM aperti).
- `/moderazione storico` — mostra gli ultimi provvedimenti di un utente con il totale dei warn.
- `/moderazione annulla` — (admin) elimina un caso registrato per errore; non annulla l'azione già eseguita su Discord.
- `/moderazione timeout` e `untimeout` — gestisce i timeout.
- `/moderazione kick`, `ban`, `unban` — gestisce espulsioni e ban.
- `/moderazione purge` — elimina fino a 100 messaggi recenti.
- `/counter setup` — assegna un canale a un counter (membri, online, bot).
- `/counter aggiorna`, `mostra`, `rimuovi` — forza l'aggiornamento, mostra la configurazione o smette di aggiornare un counter.
- `/regole pubblica` — pubblica o aggiorna il regolamento in un canale.
- `/regole config` — personalizza titolo, testo, footer e colore del regolamento.
- `/regole mostra` — anteprima del regolamento.
- `/ticket setup` — (admin) categoria, canale pannello, canale log, archivio transcript, fino a 3 ruoli staff, max ticket per utente.
- `/ticket config` — (admin) titolo, descrizione, pulsante, footer, colore del pannello e messaggio di benvenuto (`{user}` `{staff}` `{ticket}`); senza opzioni mostra la configurazione.
- `/ticket pannello` — (admin) pubblica il pannello ticket (se già presente nello stesso canale lo aggiorna invece di duplicarlo).
- `/ticket trasferisci` — trasferisce l'accesso del ticket a un membro staff o ruolo.
- `/ticket aggiungi` / `/ticket rimuovi` — dà o toglie l'accesso al ticket a un utente.
- `/ticket transcript` — genera a richiesta il transcript HTML del ticket corrente (funziona anche su un ticket già chiuso).

## Logging

Il modulo registra eventi disponibili tramite Discord Gateway: entrate/uscite membri, nickname e ruoli membro, messaggi modificati/eliminati quando il contenuto è disponibile, creazione/modifica/eliminazione canali e ruoli, ban/unban, ingressi/uscite/spostamenti vocali e alcune modifiche principali al server.

Categorie assegnabili con `/setup logs categoria:…`: `members`, `messages`, `channels`, `roles`, `moderation`, `ticket`, `voice`, `server`.

**Sanzioni**: ogni comando `/moderazione` completato invia nel canale `moderation` un embed “Sanzione: …” con utente, staff, motivo, numero di caso e dettagli (durata del timeout, giorni di messaggi eliminati col ban). Lo stesso dato resta nella tabella `moderation_cases` ed è consultabile con `/moderazione storico`.

**Ticket**: apertura, claim, trasferimento, aggiunta/rimozione membri, generazione manuale del transcript, chiusura, riapertura ed eliminazione inviano un embed nel canale `ticket` (impostabile con `/setup logs categoria:ticket` oppure `/ticket setup log`). Se nessuno dei due è configurato si usa il canale archivio transcript. Il log di chiusura riporta anche la durata del ticket; ogni evento è registrato in `ticket_logs`.

Discord non rende disponibili tutti gli eventi né garantisce sempre l'identificazione dell'autore. Gli Audit Logs richiedono il permesso View Audit Log e possono avere ritardi. I messaggi eliminati prima che il bot li abbia ricevuti o non presenti in cache potrebbero non avere contenuto recuperabile.

## Ticket e transcript

**Configurazione rapida** (dal server, come amministratore):

1. `/ticket setup` con `categoria`, `pannello`, `log`, `staff` (e opzionalmente `transcript`, `staff2`, `staff3`).
2. `/ticket config` per titolo/descrizione/benvenuto (facoltativo).
3. `/ticket pannello` per pubblicare il pannello. Il link del canale del pannello va poi inserito nel sito (`DISCORD_TICKET_URL`).

`/setup tickets` continua a funzionare. In alternativa alle slash command puoi usare le variabili d'ambiente `TICKET_*` di `.env.example` (valori di riserva: il database ha la precedenza). Nessun ID è precompilato.

**Flusso**: il pulsante *Apri Ticket* crea un canale privato (visibile solo a chi apre, ruoli staff e bot), manda il benvenuto con ping allo staff e registra l'evento in database e nel canale log. Nel ticket: *Claim*, *Chiudi ticket*. Alla chiusura viene inviato il transcript HTML all'archivio, il canale resta (sola lettura per l'utente) con i pulsanti *Riapri ticket* e *Elimina ticket* (solo staff, con conferma). Se il transcript non può essere inviato il ticket resta aperto, per non perdere la conversazione.

**Transcript**: il file HTML è un documento autonomo (stile Discord, con avatar, date in ora italiana, allegati cliccabili e badge BOT) generato da `src/systems/transcripts.js`. Viene allegato all'archivio alla chiusura e si può rigenerare in qualsiasi momento con `/ticket transcript`, anche su un ticket già chiuso; il download è visibile solo a chi esegue il comando.

**Protezioni**: permessi verificati a ogni azione, blocco anti-doppio-click e limite di ticket per utente, record orfani (canale cancellato a mano) ripuliti, errori API gestiti con messaggio all'utente, nessun token nei log. Le operazioni sono nella tabella `ticket_logs`.

I collegamenti agli allegati puntano ai file ospitati da Discord e potrebbero non essere permanenti. I transcript contengono dati potenzialmente privati: limita l'accesso al canale archivio e definisci una politica di conservazione.

## Counter

I counter sono canali (meglio **vocali**) rinominati dal bot con il conteggio: membri, utenti online o bot. `{count}` nel formato viene sostituito dal numero.

1. `/counter setup tipo:Membri canale:<canale vocale> formato:Membri: {count}`
2. Ripeti il setup per gli altri tipi, se ti servono.

Discord consente **2 rinomine ogni 10 minuti per canale**: il bot non supera mai il limite e aggiorna solo quando il valore cambia davvero. All'avvio e ogni 10 minuti ripete il controllo; il valore non viene inventato se le presenze non sono ancora disponibili.

## Regolamento

`/regole config testo:Regola uno\nRegola due` salva le regole (vengono numerate automaticamente), poi `/regole pubblica canale:<canale>` le pubblica. Se il regolamento è già in quel canale viene aggiornato invece di essere duplicato.

## Test

```bash
npm test      # flusso ticket, counter e regolamento con oggetti Discord simulati
npm run check # controllo sintattico di tutti i file
```

## Controlli di sicurezza

- Non condividere mai il token del bot.
- Non caricare `.env` su GitHub.
- Concedi al bot solo i permessi strettamente necessari.
- Il ruolo del bot deve essere posizionato sopra i ruoli che deve gestire.
- Verifica i permessi e i canali in un server di test prima dell'uso in produzione.
- SQLite viene salvato localmente nella cartella `data/`.

## Stato del progetto

Questa è una prima versione di sviluppo. Prima di usarla in un server reale servono test end-to-end, ulteriori categorie di log, miglioramenti del flusso ticket e verifiche dei permessi.

## Licenza

MIT. Vedi [LICENSE](LICENSE).
