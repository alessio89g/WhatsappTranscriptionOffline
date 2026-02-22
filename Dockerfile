FROM openvino/ubuntu22_runtime:latest

USER root

# Installa Node.js, Chrome, ffmpeg, Python, supervisor e altre dipendenze
RUN apt-get update && apt-get install -y curl wget gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb stable main" >> /etc/apt/sources.list.d/google.list && \
    apt-get update && apt-get install -y --no-install-recommends \
        nodejs \
        google-chrome-stable \
        ffmpeg \
        python3 python3-pip \
        supervisor \
        libsndfile1 \
        fonts-liberation \
        libappindicator3-1 \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libc6 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libexpat1 \
        libfontconfig1 \
        libgbm1 \
        libgcc1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libstdc++6 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxrandr2 \
        libxrender1 \
        libxss1 \
        libxtst6 \
        lsb-release \
        xdg-utils \
        ocl-icd-libopencl1 \
        clinfo \
        vainfo \
    && rm -rf /var/lib/apt/lists/*

# Installa driver Intel GPU
WORKDIR /tmp
RUN apt-get update && apt-get install -y wget && \
    wget https://github.com/intel/intel-graphics-compiler/releases/download/igc-1.0.17384.11/intel-igc-core_1.0.17384.11_amd64.deb && \
    wget https://github.com/intel/intel-graphics-compiler/releases/download/igc-1.0.17384.11/intel-igc-opencl_1.0.17384.11_amd64.deb && \
    wget https://github.com/intel/compute-runtime/releases/download/24.31.30508.7/intel-level-zero-gpu_1.3.30508.7_amd64.deb && \
    wget https://github.com/intel/compute-runtime/releases/download/24.31.30508.7/intel-opencl-icd_24.31.30508.7_amd64.deb && \
    wget https://github.com/intel/compute-runtime/releases/download/24.31.30508.7/libigdgmm12_22.4.1_amd64.deb && \
    dpkg -i *.deb || true && \
    apt-get install -f -y && \
    rm -rf /tmp/*.deb

# Crea directory per i device GPU
RUN mkdir -p /dev/dri

# Variabili ambiente per Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Imposta il fuso orario
ENV TZ=Europe/Rome
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# ------------------------------------------------------------
# Copia dei file dell'applicazione
# ------------------------------------------------------------

WORKDIR /app

# 1. Copia package.json e installa le dipendenze Node.js
COPY package.json /app/
RUN npm install

# 2. Copia i file di configurazione e script Node.js
COPY .env /app/
COPY index.js /app/

# 3. Copia i modelli (solo il nuovo modello)
COPY openvino_model_lm /app/openvino_model_lm/

# 4. Setup del server Python
RUN mkdir -p /app/server
COPY server/requirements.txt /app/server/
RUN pip3 install --no-cache-dir -r /app/server/requirements.txt
COPY server/app.py /app/server/

# 5. Configura supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 6. Aggiungi script di entrypoint per pulire i file di lock di Chrome
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]