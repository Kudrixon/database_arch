# Database Arch

This repository contains a simple web application for designing virtual infrastructure. Data is stored in a local SQLite database.

## Running

Use docker-compose to start the backend and frontend:

```bash
docker-compose up --build
```

The frontend will be available on `http://localhost:3000` and the backend on `http://localhost:4000`.

## Exporting to KubeVirt

An endpoint `/export/kubevirt` is provided to generate a YAML blueprint using KubeVirt CRDs. The YAML contains a `VirtualMachine` definition for every VM stored in the database and a `ConfigMap` listing all connections. You can fetch it manually:

```bash
curl http://localhost:4000/export/kubevirt -o kubevirt-blueprint.yaml
```

In the UI there is also a **Download YAML** button to retrieve the same file.


