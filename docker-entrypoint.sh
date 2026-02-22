#!/bin/bash
# docker-entrypoint.sh

echo "Pulizia file di lock di Chrome in /app/session_data/session/"
rm -f /app/session_data/session/Singleton*

echo "Avvio supervisord..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf