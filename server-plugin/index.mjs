import { createHash } from 'node:crypto';

export const info = {
    id: 'logic-engine',
    name: 'Logic-Engine Host Adapter',
    description: 'Authenticated SillyTavern server-side bridge to Logic-Engine Core.',
};

function resolveCoreUrl(value) {
    const parsed = new URL(value || 'http://127.0.0.1:8787');
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('LOGIC_ENGINE_URL must be an HTTP(S) origin without credentials, query, or fragment.');
    }
    return parsed.href.replace(/\/+$/, '');
}

export function createLogicEnginePlugin({
    coreUrl = process.env.LOGIC_ENGINE_URL || 'http://127.0.0.1:8787',
    fetchImpl = globalThis.fetch,
    hostId = process.env.LOGIC_ENGINE_HOST_ID || 'sillytavern-default',
} = {}) {
    const baseUrl = resolveCoreUrl(coreUrl);
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required.');

    function requireSession(req, res) {
        // SillyTavern mounts server plugins after requireLoginMiddleware.
        // Still fail closed if the expected authenticated user context is absent.
        const handle = req?.user?.profile?.handle;
        if (typeof handle !== 'string' || !handle.trim()) {
            res.status(403).json({ error: { code: 'ST_SESSION_REQUIRED' } });
            return null;
        }
        return handle;
    }

    return {
        init(router) {
            router.get('/session', (req, res) => {
                const handle = requireSession(req, res);
                if (!handle) return;
                const userRoot = req.user?.directories?.root;
                const installationScope = typeof userRoot === 'string' && userRoot.trim() ? userRoot : hostId;
                const subjectId = createHash('sha256')
                    .update(installationScope + '\0' + handle, 'utf8')
                    .digest('hex');
                return res.set('Cache-Control', 'no-store').json({
                    authenticated: true,
                    subject_id: subjectId,
                    adapter: 'sillytavern-server-plugin',
                    protocol_version: 'v1',
                });
            });

            router.get('/health', async (req, res) => {
                if (!requireSession(req, res)) return;
                try {
                    const upstream = await fetchImpl(baseUrl + '/health', {
                        method: 'GET',
                        headers: { Accept: 'application/json' },
                        redirect: 'error',
                        signal: AbortSignal.timeout(5000),
                    });
                    if (!upstream.ok) {
                        return res.status(503).set('Cache-Control', 'no-store').json({
                            ok: false,
                            error: { code: 'CORE_UNAVAILABLE', status: upstream.status },
                        });
                    }
                    const health = await upstream.json();
                    if (health?.ok !== true || health?.service !== 'logic-engine') {
                        return res.status(502).set('Cache-Control', 'no-store').json({
                            ok: false,
                            error: { code: 'INVALID_CORE_HEALTH_RESPONSE' },
                        });
                    }
                    return res.set('Cache-Control', 'no-store').json({
                        ok: true,
                        host_adapter: true,
                        core: health,
                    });
                } catch {
                    return res.status(503).set('Cache-Control', 'no-store').json({
                        ok: false,
                        error: { code: 'CORE_UNREACHABLE' },
                    });
                }
            });
        },
    };
}

export function init(router) {
    createLogicEnginePlugin().init(router);
}
