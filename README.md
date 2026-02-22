# WhatsappTranscriptionOffline

Questo progetto realizza un bot per WhatsApp in grado di trascrivere automaticamente i messaggi vocali ricevuti, completamente in locale e senza inviare dati a servizi esterni. L'intera elaborazione avviene all'interno di un container Docker in modalità WSL2, sfruttando l'accelerazione GPU Intel integrata (OpenVINO) per garantire velocità e privacy.

L'idea del progetto è nata sulle basi di questo repository: <br>
https://github.com/puluceno/WhatsappTranscriptionOffline <br>
La quasi totalità del codice è stata generata da DeepSeek; io ho per lo più fatto da tester per il debugging ed orchestrato il suo lavoro.

## GUIDA RAPIDA
 Installare Docker in modalità WSL2 <br>
 
 Scaricare dalla sezione Releases i file <br>
Source code.zip <br>
 e <br>
openvino_model.bin <br>
 Estrarre il contenuto del file compresso nel suo percorso definitivo <br>
 Assegnare alla cartella contenente i file del progetto il nome <br>
WhatsappTranscriptionOffline <br>
 Spostare il file <br>
openvino_model.bin <br>
 all'interno della cartella <br>
openvino_model_lm <br>

 Avviare il Terminale nella cartella del progetto ed eseguire i comandi di build ed avvio del container <br>
docker-compose down <br>
docker-compose up -d --build <br>

 Aprire il log del container con il comando <br>
docker logs -f WhatsAppTranscriptionOffline_Container <br>
 Aprire adesso <br>
WhatsApp <br>
 sullo smartphone, toccare l'icona dell' <br>
Overflow menu <br>
 selezionare <br>
Dispositivi collegati <br>
 e poi <br>
Collega un dispositivo <br>
 Inquadrare quindi il QRcode nel log visibile nella finestra del Terminale. <br>
 Attendere l'output <br>
WhatsApp client is ready! <br>
 Al completamento dell'operazione, sarà possibile chiudere il Terminale. <br>


## Panoramica dell'architettura

Il sistema gira su Ubuntu 22.04.5 LTS (Jammy Jellyfish) ed è composto da tre componenti principali che cooperano all'interno del container:

1.  **Node.js (whatsapp-web.js)** – Si occupa dell'interazione con WhatsApp.
2.  **Server Python (FastAPI)** – Esegue la trascrizione vera e propria utilizzando modelli di deep learning.
3.  **Supervisord** – Gestisce l'avvio e il monitoraggio dei due processi (Node e Python), assicurando che vengano sempre eseguiti e riavviati in caso di crash.

Questi componenti comunicano tra loro tramite HTTP su localhost all'interno del container. L'utente finale interagisce solo con il bot WhatsApp, senza mai accorgersi della complessità sottostante.

## Componenti in dettaglio

### 1. Client WhatsApp (Node.js) – `index.js`

Questo script costituisce il cuore dell'interfaccia con WhatsApp. Utilizza la libreria `whatsapp-web.js` per simulare un client WhatsApp Web e rimanere in ascolto dei messaggi.
Il client whatsapp-web.js utilizza Puppeteer per controllare un’istanza headless di Google Chrome. Questo browser si connette al servizio WhatsApp Web, esegue il rendering della pagina e gestisce la comunicazione in tempo reale con i server di WhatsApp.

*   **Avvio e autenticazione:** Alla prima esecuzione, il client mostra un **codice QR** nel log del container. L'utente deve inquadrarlo con WhatsApp (da `Impostazioni > Dispositivi collegati`) per autenticare il bot. La sessione viene poi salvata nella cartella `session_data`, in modo che alle successive esecuzioni il riavvio sia automatico e senza necessità di ri-scan.
*   **Ricezione di un vocale:** Quando arriva un messaggio di tipo audio (vocale), il client:
    1.  Scarica il file audio (in formato `.ogg` o simile).
    2.  **Calcola la durata** del file originale usando `ffprobe` e la registra nei log.
    3.  **Converte** il file in formato WAV a 16kHz mono, necessario per il modello di trascrizione, utilizzando `ffmpeg`.
    4.  **Calcola la durata** del file WAV convertito (dovrebbe essere molto simile all'originale).
    5.  **Invia il file WAV** al server Python (via HTTP POST) e avvia un timer.
    6.  Riceve la trascrizione (testo) dal server Python.
    7.  **Arresta il timer** e calcola il tempo totale impiegato per l'elaborazione.
    8.  **Risponde al messaggio vocale** su WhatsApp con il testo trascritto, preceduto dall'intestazione *"🗣️ Trascrizione Automatica Nota Vocale:"*.
    9.  **Cancella** i file audio temporanei (originale e convertito) dal filesystem.
*   **Privacy nei log:** Lo script è stato configurato per non registrare mai il contenuto della trascrizione. Invece, nei log vengono riportate informazioni utili per il monitoraggio delle prestazioni:
    *   La **durata** del messaggio vocale originale (in secondi).
    *   La **durata del file convertito**.
    *   Il **tempo totale di elaborazione**, ovvero il tempo intercorso tra l'invio della richiesta al server Python e la ricezione della risposta. Questo dato, insieme alla durata dell'audio, permette di valutare la velocità del sistema (ad esempio, "Tempo di elaborazione: 5.82 secondi per un audio di 12.34 secondi").

### 2. Server di Trascrizione (Python/FastAPI) – `server/app.py`

Questo server espone un endpoint HTTP `POST /transcribe` che riceve il file audio WAV, lo elabora e restituisce la trascrizione in formato JSON.

*   **Modello di riconoscimento vocale:** utilizza un modello **wav2vec2** da 1 miliardo di parametri (`radiogroup-crits/wav2vec2-xls-r-1b-italian-doc4lm-5gram`), specificamente addestrato per la lingua italiana. Il modello è stato convertito in formato OpenVINO per essere eseguito in modo efficiente sulla GPU integrata Intel. OpenVINO richiede una GPU Intel integrata di 6ª generazione (Skylake) o superiore oppure una GPU Intel ARC e GPU Intel discrete. La conversione è stata effettuata tramite lo strumento `optimum-cli`.
*   **Pipelining e chunking:** Il modello viene caricato all'interno di una pipeline Hugging Face di tipo `automatic-speech-recognition`. Questa pipeline gestisce automaticamente la suddivisione di file audio lunghi in **chunk (segmenti) di 30 secondi** con una sovrapposizione (stride) di 5 secondi, garantendo la trascrizione corretta anche di messaggi vocali di durata superiore ai 30 secondi.
*   **Punteggiatura:** La trascrizione grezza prodotta da wav2vec2 è in maiuscolo e priva di punteggiatura. Per migliorare la leggibilità, il testo viene passato a un secondo modello, **`oliverguhr/fullstop-punctuation-multilang-large`**, che si occupa di aggiungere punti, virgole e maiuscole. Anche questo modello viene eseguito localmente.
*   **Interazione:** Il server, una volta avviato, rimane in ascolto. Alla ricezione di un file, lo salva temporaneamente in `/tmp`, lo elabora, restituisce il risultato e **cancella immediatamente il file temporaneo**. Non viene mai creata una copia persistente dell'audio sul server.
*   **Log:** Il server Python registra solo eventi di avvio, errori e, se richiesto, informazioni di debug (ora disabilitate). **Non registra mai il contenuto delle trascrizioni**.

### 3. Gestore dei processi (Supervisord) – `supervisord.conf`

Supervisord è uno strumento che garantisce che i due processi (Node.js e Python) siano sempre attivi. All'avvio del container, l'entrypoint script avvia supervisord, che a sua volta:

1.  **Avvia i due programmi** (`node` e `python`).
2.  **Ne monitora lo stato.** Se uno dei due termina inaspettatamente, supervisord lo riavvia automaticamente.
3.  **Redirige l'output** dei due programmi direttamente verso i log del container (`/dev/fd/1`). In questo modo, usando `docker logs`, si può vedere tutto l'output di entrambi i componenti in un unico flusso.

### 4. Entrypoint e Pulizia – `docker-entrypoint.sh`

Questo semplice script bash viene eseguito come primo comando all'avvio del container. Ha due compiti fondamentali:

1.  **Pulire eventuali file di lock di Chrome.** A volte, se il container non viene spento correttamente, Chrome lascia dei file bloccanti (`Singleton*`) nella directory della sessione, che impedirebbero al client WhatsApp di ripartire. Lo script li elimina prima di avviare supervisord.
2.  **Avviare supervisord** con il file di configurazione appropriato.

### 5. La persistenza: la cartella `session_data`

Questa cartella è montata come volume nel container (vedi `docker-compose.yml`). Contiene tutti i dati relativi alla sessione autenticata di WhatsApp. Se la cartella viene eliminata, alla successiva esecuzione il bot mostrerà nuovamente il QR code per essere ri-autenticato.

## Gestione dei file e della privacy

Una delle caratteristiche più importanti del progetto è l'attenzione alla privacy e alla pulizia:

*   **Nessun salvataggio permanente dell'audio:** I file audio (sia originali che convertiti) vengono cancellati immediatamente dopo l'uso da `index.js`.
*   **Nessuna trascrizione su disco:** Il testo trascritto viaggia solo via HTTP e non viene mai scritto in un file di log o di testo.
*   **Log anonimi e prestazionali:** I log non contengono numeri di telefono, nomi di gruppi o testo dei messaggi. Contengono solo informazioni tecniche necessarie al monitoraggio, come la durata degli audio e i tempi di elaborazione. L'unico riferimento a un utente è generico (`user` o `group`).
*   **Rotazione dei log di Docker:** Per evitare che i log crescano all'infinito, nel file `docker-compose.yml` è configurata una rotazione automatica: i log vengono suddivisi in file da massimo 100 MB e vengono conservate solo le ultime 3 parti.

## Riepilogo del flusso di un messaggio vocale

1.  L'utente invia un vocale a un contatto o gruppo monitorato dal bot.
2.  `index.js` riceve l'evento, scarica l'audio e salva un file temporaneo (`originale.ogg`).
3.  `index.js` usa `ffprobe` per misurare la durata dell'originale e la registra nel log.
4.  `index.js` usa `ffmpeg` per convertire l'audio in `audio.wav` (16kHz, mono).
5.  `index.js` misura la durata del file convertito.
6.  `index.js` invia il file `.wav` al server Python (`http://localhost:8000/transcribe`) tramite una richiesta HTTP POST, avviando un timer.
7.  Il server Python (`app.py`) riceve il file, lo salva in `/tmp`, lo passa alla pipeline ASR (che lo suddivide in chunk se necessario) e ottiene una trascrizione grezza.
8.  Il server Python passa la trascrizione grezza al modello di punteggiatura.
9.  Il server Python restituisce il testo finale (con punteggiatura) a `index.js` come risposta JSON.
10. `index.js` arresta il timer, calcola e registra il tempo di elaborazione.
11. `index.js` invia il testo trascritto come risposta al messaggio vocale su WhatsApp.
12. `index.js` cancella i file `originale.ogg` e `audio.wav`.
13. Il server Python cancella il file temporaneo in `/tmp`.

Il sistema è ora pronto per ricevere il prossimo messaggio vocale.

Configurazione e variabili d’ambiente

Il comportamento del bot può essere modificato attraverso le variabili d’ambiente definite nel file .env:

- GROUPS: elenco di ID di gruppi autorizzati alla trascrizione (separati da virgola). Se impostato a “*” (default), la trascrizione è attiva per tutte le chat private e tutti i gruppi.
- PATH_AUDIO: directory in cui salvare temporaneamente i file audio (default “.”, ovvero /app all’interno del container).
- TZ: fuso orario per i timestamp nei log (default Europe/Rome).


Componenti esterni utilizzati

- Node.js: runtime JavaScript.
- whatsapp-web.js: libreria per interfacciarsi a WhatsApp Web.
- Puppeteer: controlla Chrome in modalità headless.
- ffmpeg / ffprobe: conversione audio e estrazione metadati.
- Python 3.10: runtime per il server di trascrizione.
- FastAPI + Uvicorn: server web asincrono.
- Transformers / Optimum: caricamento e ottimizzazione dei modelli.
- OpenVINO: backend per l’accelerazione su GPU Intel.
- deepmultilingualpunctuation: modello per la punteggiatura.
- Supervisord: gestione dei processi all’interno del container.
