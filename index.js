import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { request } from "undici";

const app = express();
app.use(cors());
const PORT = 3000;


const BASE_URL = "https://moviebox.ph";
const API_BASE = "https://h5-api.aoneroom.com/wefeed-h5api-bff";

let _bearer_token = null;

const SubjectType = {
    ALL: 0,
    MOVIES: 1,
    TV_SERIES: 2,
    MUSIC: 6
};

const axiosInstance = axios.create({
    timeout: 30000
});


const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "Referer": "https://moviebox.ph/",
    "Origin": "https://moviebox.ph",
    "X-Client-Info": '{"timezone":"Asia/Dhaka"}',
    "X-Request-Lang": "en",
    "Accept": "application/json",
    "Content-Type": "application/json",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
};

const PLAYER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "X-Client-Info": '{"timezone":"Asia/Dhaka"}',
    "X-Source": "",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
};




async function _getBearerToken() {
    if (_bearer_token) return _bearer_token;

    const resp = await axiosInstance.get(
        `${API_BASE}/home?host=moviebox.ph`,
        {
            headers: DEFAULT_HEADERS
        }
    );

    const xUser = resp.headers['x-user'];

    if (xUser) {
        try {
            const parsed = JSON.parse(xUser);

            if (parsed.token) {
                _bearer_token = parsed.token;
            }
        } catch (error) {
            console.error('Failed to parse x-user:', error.message);
        }
    }

    if (!_bearer_token) {
        const setCookies = resp.headers['set-cookie'] || [];

        for (const cookie of setCookies) {
            const match = cookie.match(/token=([^;]+)/);

            if (match) {
                _bearer_token = match[1];
                break;
            }
        }
    }

    return _bearer_token || '';
}
async function _makeRequest(url, method = 'GET', payload = null, customHeaders = null) {
    const token = await _getBearerToken();
    const headers = {
        ...DEFAULT_HEADERS,
        Authorization: token ? `Bearer ${token}` : '',
        ...(customHeaders || {})
    };
    try {
        const resp = method === 'POST'
        ? await axiosInstance.post(url, payload, { headers })
        : await axiosInstance.get(url, { headers });
        const xUser = resp.headers['x-user'];
        if (xUser) {
            const newToken = JSON.parse(xUser).token;
            if (newToken) _bearer_token = newToken;
        }
        if (resp.status !== 200) throw new Error(`Upstream API error: ${resp.status}`);
        return resp.data;
    } catch (e) {
        throw new Error(`Request failed: ${e.message}`);
    }
}

app.get('/home', async (req, res) => {
    const data = await _makeRequest(`${API_BASE}/home?host=moviebox.ph`);
    const sections = [];
    for (const op of data.data.operatingList || []) {
        const opType = op.type;
        const title = op.title || 'Featured';
        if (opType === 'BANNER') {
            const items = op.banner.items.map(item => ({
                name: item.title || (item.subject || {}).title,
                poster_url: item.image.url || (item.subject || {}).cover.url,
                slug: item.detailPath || (item.subject || {}).detailPath,
                subject_id: (item.subject || {}).subjectId,
                badge: (item.subject || {}).corner
            })).filter(item => item.title && !item.title.includes('Communities'));
            sections.push({ section: 'Banner', count: items.length, items });
        } else if (['SUBJECTS_MOVIE', 'SUBJECTS_TV', 'SUBJECTS_ANIMATION'].includes(opType)) {
            const items = op.subjects.map(sub => ({
                name: sub.title,
                poster_url: sub.cover.url,
                slug: sub.detailPath,
                subject_id: sub.subjectId,
                badge: sub.corner,
                rating: sub.imdbRatingValue
            }));
            sections.push({ section: title, count: items.length, items });
        }
    }
    res.json({ status: 'success', sections });
});

async function _getCategoryData(tabId, page = 1, perPage = 24, sort = 'RECOMMEND') {
    const url = `${API_BASE}/subject/filter`;
    const payload = { tabId, filter: { sort, genre: 'ALL', country: 'ALL', year: 'ALL', language: 'ALL' }, page, perPage };
    const data = await _makeRequest(url, 'POST', payload);
    const inner = data.data;
    const rawItems = inner.items || inner.subjects || [];
    const items = rawItems.map(sub => ({
        name: sub.title,
        poster_url: sub.cover.url,
        slug: sub.detailPath,
        subject_id: sub.subjectId,
        badge: sub.corner,
        rating: sub.imdbRatingValue,
        year: sub.releaseDate ? sub.releaseDate.slice(0, 4) : null
    }));
    const pager = inner.pager || {};
    const total = pager.totalCount || inner.total || items.length;
    return { page, perPage, total, items };
}

app.get('/movies', async (req, res) => res.json(await _getCategoryData(2, req.query.page, req.query.sort)));
app.get('/tv-series', async (req, res) => res.json(await _getCategoryData(5, req.query.page, req.query.sort)));
app.get('/animation', async (req, res) => res.json(await _getCategoryData(8, req.query.page, req.query.sort)));

app.get('/search/suggest', async (req, res) => {
    const url = `${API_BASE}/subject/search-suggest`;
    const data = await _makeRequest(url, 'POST', { keyword: req.query.q, perPage: 10 });
    const inner = data.data;
    const raw = inner.items || inner.list || [];
    const suggestions = raw.map(item => ({
        title: (item.subject || {}).title || item.word || item.title,
        slug: (item.subject || {}).detailPath || item.detailPath,
        subject_id: (item.subject || {}).subjectId || item.subjectId
    }));
    res.json({ suggestions });
});

app.get('/search', async (req, res) => {
    const url = `${API_BASE}/subject/search`;
    const data = await _makeRequest(url, 'POST', { keyword: req.query.q, page: req.query.page, perPage: 20 });
    const inner = data.data;
    const raw = inner.items || inner.list || [];
    const items = raw.map(sub => ({
        name: sub.title,
        poster_url: sub.cover.url,
        slug: sub.detailPath,
        subject_id: sub.subjectId
    }));
    const pager = inner.pager || {};
    const total = pager.totalCount || inner.total || items.length;
    res.json({ query: req.query.q, page: req.query.page, total, items });
});

app.get('/detail/:slug', async (req, res) => {
    const url = `${API_BASE}/detail?detailPath=${req.params.slug}`;
    res.json(await _makeRequest(url));
});


app.get("/api/download", async (req, res) => {
    try {
        const { url, filename = "video.mp4" } = req.query;

        if (!url) {
            return res.status(400).json({
                error: "Missing url"
            });
        }

        let target;

        try {
            target = new URL(url);
        } catch {
            return res.status(400).json({
                error: "Invalid URL"
            });
        }

        const headers = {
            "User-Agent":
                "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/148 Mobile Safari/537.36",
            "Accept": "*/*",
            "Referer": "https://videodownloader.site/"
        };

        if (req.headers.range) {
            headers.Range = req.headers.range;
        }

        const upstream = await request(target.toString(), {
            method: "GET",
            headers
        });


        if (upstream.statusCode >= 400) {
            let body = "";

            try {
                body = await upstream.body.text();
            } catch {}

            return res.status(upstream.statusCode).json({
                error: "CDN rejected request",
                status: upstream.statusCode,
                body: body.slice(0, 500)
            });
        }

        const contentType =
            upstream.headers["content-type"] || "video/mp4";

        res.setHeader("Content-Type", contentType);

        if (upstream.headers["content-length"]) {
            res.setHeader(
                "Content-Length",
                upstream.headers["content-length"]
            );
        }

        if (upstream.headers["content-range"]) {
            res.setHeader(
                "Content-Range",
                upstream.headers["content-range"]
            );
        }

        if (upstream.headers["accept-ranges"]) {
            res.setHeader(
                "Accept-Ranges",
                upstream.headers["accept-ranges"]
            );
        }

        // Set the filename
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`
        );

        res.setHeader(
            "Access-Control-Allow-Origin",
            "*"
        );

        res.setHeader(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition"
        );

        res.status(upstream.statusCode);

        upstream.body.pipe(res);

    } catch (error) {
        console.error(
            "DOWNLOAD PROXY ERROR:",
            error.message
        );

        if (!res.headersSent) {
            res.status(500).json({
                error: error.message
            });
        }
    }
});

// Simple in-memory TTL cache — fine for a single Node process. If you ever
// run this behind PM2 cluster mode or multiple instances, each process
// gets its own cache, so move this to Redis (or similar) at that point.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const streamCache = new Map();
const captionCache = new Map();

function getCached(cache, key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.time > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function setCached(cache, key, value) {
    cache.set(key, { value, time: Date.now() });
}

app.get('/api/stream/:subject_id', async (req, res) => {
    const { subject_id } = req.params;
    const { detail_path, se = 1, ep = 1 } = req.query;

    const cacheKey = `${subject_id}:${detail_path}:${se}:${ep}`;
    const cached = getCached(streamCache, cacheKey);
    if (cached) return res.json(cached);

    const domData = await _makeRequest(`${API_BASE}/media-player/get-domain`);
    const domain = domData.data || 'https://netfilm.world';
    const playerReferer = `${domain}/spa/videoPlayPage/movies/${detail_path}?id=${subject_id}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
    const playUrl = `${domain}/wefeed-h5api-bff/subject/download?subjectId=${subject_id}&se=${se}&ep=${ep}&detailPath=${detail_path}`;
    const resp = await axios.get(playUrl, { headers: { ...PLAYER_HEADERS, Referer: playerReferer } });
    const data = resp.data.data;

    const hasResource = data.hasResource;
    const streams = data.downloads
        .filter(s => typeof s.url === "string" && s.url.trim() !== "")
        .map(s => {
            const filename = `${detail_path}-${s.resolution}.${s.format || "mp4"}`;

            return {
                resolution: `${s.resolution}p`,
                format: s.format,
                url: `https://bunnyforum.site/api/download?url=${encodeURIComponent(s.url)}&filename=${encodeURIComponent(filename)}`,
                size: s.size,
                duration: s.duration,
                codec: s.codecName
            };
        });

    const payload = {
        subject_id, se, ep, has_resource: hasResource, sources: streams, hls: data.hls, dash: data.dash, free_episodes: data.freeNum, limited: data.limited, note: hasResource ? null : 'No stream found for this episode.'
    };

    // Only cache a genuine hit — an empty/failed lookup shouldn't get
    // pinned for 12 hours if the upstream just needs a retry.
    if (hasResource) setCached(streamCache, cacheKey, payload);

    res.json(payload);
});


app.get('/api/stream/:subject_id/captions', async (req, res) => {
    const { subject_id } = req.params;
    const { detail_path, se = 1, ep = 1 } = req.query;

    const cacheKey = `${subject_id}:${detail_path}:${se}:${ep}`;
    const cached = getCached(captionCache, cacheKey);
    if (cached) return res.json(cached);

    const domData = await _makeRequest(`${API_BASE}/media-player/get-domain`);
    const domain = domData.data || 'https://netfilm.world';
    const playerReferer = `${domain}/spa/videoPlayPage/movies/${detail_path}?id=${subject_id}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
    const playUrl = `${domain}/wefeed-h5api-bff/subject/play?subjectId=${subject_id}&se=${se}&ep=${ep}&detailPath=${detail_path}`;
    const playResp = await axios.get(playUrl, { headers: { ...PLAYER_HEADERS, Referer: playerReferer } });
    const playData = playResp.data.data;
    const streams = playData.streams;
    const dash = playData.dash;
    let streamId, streamFormat;
    if (streams.length) {
        streamId = streams[0].id;
        streamFormat = streams[0].format || 'MP4';
    } else if (dash.length) {
        streamId = dash[0].id;
        streamFormat = dash[0].format || 'DASH';
    }
    if (!streamId) {
        // Nothing found upstream — don't cache a miss, so a later retry
        // (once the episode is actually available) isn't stuck behind it.
        return res.json({ subject_id, se, ep, count: 0, captions: [] });
    }
    const capUrl = `${API_BASE}/subject/caption?format=${streamFormat}&id=${streamId}&subjectId=${subject_id}&detailPath=${detail_path}`;
    const data = await _makeRequest(capUrl);
    const inner = data.data;
    const captions = Array.isArray(inner) ? inner : inner.captions || [];

    const payload = { subject_id, se, ep, count: captions.length, captions };
    setCached(captionCache, cacheKey, payload);

    res.json(payload);
});


if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

export default app;
