const { Client, LocalAuth } = require('whatsapp-web.js');
const mime = require('mime-types');
const fs = require('fs').promises;
const { exec } = require("child_process");
const util = require('util');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const execAsync = util.promisify(exec);

process.env.TZ = 'Europe/Rome';

function logWithTimestamp(...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}]`, ...args);
}

logWithTimestamp('[INIT] PATH_AUDIO =', process.env.PATH_AUDIO);
logWithTimestamp('[INIT] GROUPS =', process.env.GROUPS);
logWithTimestamp('[INIT] TZ =', process.env.TZ);

const path_audio = process.env.PATH_AUDIO || '.';
const groups = process.env.GROUPS || '';
const allowedGroups = groups.split(',').map(item => item.trim());

process.on('unhandledRejection', (reason, promise) => {
    logWithTimestamp('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './session_data' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-features=VizDisplayCompositor',
            '--disable-software-rasterizer',
            '--log-level=3'
        ],
        dumpio: false
    }
});

client.on('qr', (qr) => {
    logWithTimestamp('Scan this QR code with your phone:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    logWithTimestamp('WhatsApp client is ready!');
});

// Funzione per ottenere la durata di un file audio usando ffprobe
async function getAudioDuration(filePath) {
    try {
        const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
        return parseFloat(stdout);
    } catch (error) {
        logWithTimestamp(`[ERRORE] Impossibile ottenere la durata di ${filePath}: ${error.message}`);
        return null;
    }
}

client.on('message_create', async (message) => {
    if (message.from === 'status@broadcast') return;

    let senderAnon = message.from;
    if (message.from.endsWith('@c.us') || message.from.endsWith('@lid')) {
        senderAnon = 'user';
    } else if (message.from.endsWith('@g.us')) {
        senderAnon = 'group';
    }

    logWithTimestamp(`[DEBUG] Messaggio da ${senderAnon}, tipo: ${message.type}, media: ${message.hasMedia}`);

    try {
        if (!message.hasMedia) return;

        const media = await message.downloadMedia();
        if (!media || !media.mimetype) return;

        if (!media.mimetype.includes('audio') && !media.mimetype.includes('ogg') && !media.mimetype.includes('opus')) {
            return;
        }

        const chat = await message.getChat();
        const isGroup = chat.isGroup;
        const chatId = chat.id._serialized;

        let chatNameAnon = isGroup ? 'group' : 'user';

        const shouldTranscribe = (
            !isGroup ||
            allowedGroups.includes(chatId) ||
            allowedGroups.includes('*')
        );

        if (!shouldTranscribe) return;

        const d = new Date().toISOString();
        const orig = message.author || message.from;
        const origAnon = isGroup ? 'user' : senderAnon;
        logWithTimestamp(`${d}|${origAnon}|${chatNameAnon}${isGroup ? '(GROUP)' : ''}| (audio ricevuto)`);

        const suffix = Math.floor(Math.random() * 1000);
        const extension = mime.extension(media.mimetype) || 'ogg';
        const timestamp = Math.floor(Date.now() / 1000);
        const filename = `${path_audio}/${timestamp}-${suffix}.${extension}`;
        const wavFilename = `${filename}.wav`;

        await fs.writeFile(filename, media.data, 'base64');
        logWithTimestamp(`[INFO] File audio salvato: ${filename}`);

        const originalDuration = await getAudioDuration(filename);
        if (originalDuration !== null) {
            logWithTimestamp(`[INFO] Durata audio originale: ${originalDuration.toFixed(2)} secondi`);
        }

        logWithTimestamp(`[INFO] Conversione in wav 16kHz mono...`);
        await execAsync(`ffmpeg -v 0 -i ${filename} -ar 16000 -ac 1 ${wavFilename}`);
        logWithTimestamp(`[INFO] Conversione completata: ${wavFilename}`);

        try {
            await fs.access(wavFilename);
            logWithTimestamp(`[INFO] File wav trovato`);
        } catch {
            logWithTimestamp(`[ERRORE] File wav non trovato: ${wavFilename}`);
            await fs.unlink(filename).catch(() => {});
            return;
        }

        const wavDuration = await getAudioDuration(wavFilename);
        if (wavDuration !== null) {
            logWithTimestamp(`[INFO] Durata audio elaborato: ${wavDuration.toFixed(2)} secondi`);
        }

        const startTime = Date.now();
        logWithTimestamp(`[INFO] Invio al server di trascrizione...`);

        const form = new FormData();
        form.append('file', await fs.readFile(wavFilename), {
            filename: 'audio.wav',
            contentType: 'audio/wav',
        });

        try {
            const response = await axios.post('http://localhost:8000/transcribe', form, {
                headers: form.getHeaders(),
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
            const transcription = response.data.text;
            const endTime = Date.now();
            const elapsedSeconds = (endTime - startTime) / 1000;
            const audioDuration = wavDuration || originalDuration || 0;
            logWithTimestamp(`[INFO] Tempo di elaborazione: ${elapsedSeconds.toFixed(2)} secondi per un audio di ${audioDuration.toFixed(2)} secondi`);

            await message.reply(`🗣️ *Trascrizione Automatica Nota Vocale:*\n\n${transcription}`);
        } catch (error) {
            logWithTimestamp(`[ERRORE] Chiamata al server fallita: ${error.message}`);
            if (error.response) {
                logWithTimestamp(`[ERRORE] Risposta: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            }
            await fs.unlink(filename).catch(() => {});
            await fs.unlink(wavFilename).catch(() => {});
            return;
        }

        await fs.unlink(filename).catch(() => {});
        await fs.unlink(wavFilename).catch(() => {});

    } catch (error) {
        logWithTimestamp(`[ERRORE] Generale: ${error.message}`);
    }
});

client.on('disconnected', (reason) => {
    logWithTimestamp('Client was logged out:', reason);
});

client.initialize();