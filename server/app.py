import os
import numpy as np
import soundfile as sf
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from transformers import pipeline, Wav2Vec2Processor
from optimum.intel import OVModelForCTC
from deepmultilingualpunctuation import PunctuationModel
import logging

# Riduci la verbosità di Hugging Face
os.environ["HF_HUB_VERBOSITY"] = "warning"
from transformers.utils import logging as transformers_logging
transformers_logging.set_verbosity_error()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# --- MODELLO ACUSTICO con pipeline ---
model_id = "radiogroup-crits/wav2vec2-xls-r-1b-italian-doc4lm-5gram"
processor = Wav2Vec2Processor.from_pretrained(model_id)

model = OVModelForCTC.from_pretrained("/app/openvino_model_lm", compile=False)

try:
    model.to("GPU")
    logger.info("Modello spostato su GPU, ora compilo...")
except Exception as e:
    logger.warning(f"Impossibile usare GPU, passo a CPU: {e}")
    model.to("CPU")

model.compile()
logger.info("Modello acustico compilato con successo.")

model.main_input_name = "input_values"

asr_pipeline = pipeline(
    "automatic-speech-recognition",
    model=model,
    tokenizer=processor.tokenizer,
    feature_extractor=processor.feature_extractor,
    chunk_length_s=30,
    stride_length_s=5,
    return_timestamps='char',
)
logger.info("Pipeline ASR pronta con chunking automatico.")

logger.info("Caricamento del modello di punteggiatura...")
try:
    punct_model = PunctuationModel(model="oliverguhr/fullstop-punctuation-multilang-large")
    logger.info("Modello di punteggiatura caricato con successo.")
except Exception as e:
    logger.error(f"Errore nel caricare il modello di punteggiatura: {e}")
    raise e

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    temp_filename = f"/tmp/{file.filename}"
    try:
        contents = await file.read()
        with open(temp_filename, "wb") as f:
            f.write(contents)

        audio, sr = sf.read(temp_filename)
        if sr != 16000:
            raise HTTPException(status_code=400, detail="Audio must be 16kHz")
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        result = asr_pipeline(audio)
        raw_transcription = result["text"]

        punctuated_text = punct_model.restore_punctuation(raw_transcription)

        return JSONResponse({"text": punctuated_text})

    except Exception as e:
        logger.exception("Errore durante la trascrizione")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_filename):
            os.remove(temp_filename)