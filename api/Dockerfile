FROM python:3.12-slim

# Built from the REPO ROOT, not from api/ — services/briefs/taxonomy.py reads
# frontend/lib/renter-facing-groups.json, so the image needs both directories.
# Railway: Settings -> Source -> Root Directory = "/", Dockerfile Path = "api/Dockerfile".
#
# The image mirrors the repo layout (/app/api, /app/frontend/lib) rather than
# flattening api/ to /app, so the parent-walk in taxonomy.py resolves the same
# number of levels up in the container as it does in a checkout. Flattening
# would work only by planting a bare /frontend at the filesystem root.
WORKDIR /app/api

COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ .

# The renter-facing taxonomy. Not part of api/, but imported at startup by
# routes/hpd.py via services.briefs.taxonomy — see that module's docstring for
# why the file lives on the frontend side. Missing it is an import-time crash,
# not a degraded response.
COPY frontend/lib/renter-facing-groups.json /app/frontend/lib/

RUN useradd --no-create-home appuser && chown -R appuser /app
USER appuser

EXPOSE 8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
