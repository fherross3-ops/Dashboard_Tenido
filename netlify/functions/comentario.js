// Netlify Function: POST /api/comentario
// Escribe un comentario en data/comentarios.csv vía GitHub API

const GITHUB_API = 'https://api.github.com';

// Configura estas variables de entorno en Netlify:
//   GITHUB_TOKEN  = token con permiso "repo" (o "Contents: Read & Write")
//   GITHUB_REPO   = "usuario/repositorio"   (ej: "miempresa/dashboard-tenido")
//   GITHUB_BRANCH = "main"                   (opcional, por defecto "main")

const CSV_PATH = 'data/comentarios.csv';

exports.handler = async (event) => {
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: cors, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: cors, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
    }

    const TOKEN  = process.env.GITHUB_TOKEN;
    const REPO   = process.env.GITHUB_REPO;
    const BRANCH = process.env.GITHUB_BRANCH || 'main';

    if (!TOKEN || !REPO) {
        return {
            statusCode: 500, headers: cors,
            body: JSON.stringify({ ok: false, error: 'Backend sin configurar (faltan GITHUB_TOKEN / GITHUB_REPO)' })
        };
    }

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'JSON inválido' }) };
    }

    const { fecha, nombre, categoria, maquina, comentario } = payload;

    if (!fecha || !comentario) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'Faltan campos obligatorios (fecha, comentario)' }) };
    }

    // Escapar para CSV
    const esc = (s) => {
        const str = String(s ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const timestamp = new Date().toISOString();
    const nuevaLinea = [
        esc(id),
        esc(fecha),
        esc(timestamp),
        esc(nombre || 'Anónimo'),
        esc(categoria || 'General'),
        esc(maquina || ''),
        esc(comentario)
    ].join(',');

    const url = `${GITHUB_API}/repos/${REPO}/contents/${CSV_PATH}`;
    const headers = {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'netlify-tenido-dashboard'
    };

    try {
        // 1. Leer archivo actual (si existe)
        const getResp = await fetch(`${url}?ref=${BRANCH}`, { headers });
        let sha = null;
        let contenidoActual = '';

        if (getResp.ok) {
            const data = await getResp.json();
            sha = data.sha;
            contenidoActual = Buffer.from(data.content, 'base64').toString('utf-8');
        } else if (getResp.status !== 404) {
            const txt = await getResp.text();
            throw new Error(`GitHub GET ${getResp.status}: ${txt}`);
        }

        // Asegurar cabecera
        const cabecera = 'id,fecha,timestamp,nombre,categoria,maquina,comentario';
        let nuevoContenido;
        if (!contenidoActual || contenidoActual.trim() === '') {
            nuevoContenido = cabecera + '\n' + nuevaLinea + '\n';
        } else {
            const limpio = contenidoActual.replace(/\s+$/, '');
            nuevoContenido = limpio + '\n' + nuevaLinea + '\n';
        }

        // 2. PUT para actualizar
        const putResp = await fetch(url, {
            method: 'PUT',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `comentario: ${fecha} - ${categoria || 'General'}`,
                content: Buffer.from(nuevoContenido, 'utf-8').toString('base64'),
                branch: BRANCH,
                ...(sha ? { sha } : {})
            })
        });

        if (!putResp.ok) {
            const txt = await putResp.text();
            throw new Error(`GitHub PUT ${putResp.status}: ${txt}`);
        }

        return {
            statusCode: 200, headers: cors,
            body: JSON.stringify({ ok: true, id, timestamp })
        };

    } catch (err) {
        console.error('Error en comentario.js:', err);
        return {
            statusCode: 500, headers: cors,
            body: JSON.stringify({ ok: false, error: err.message })
        };
    }
};
