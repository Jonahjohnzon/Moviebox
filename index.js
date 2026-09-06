import express from 'express';
import cors from 'cors';
import axios from 'axios';


const app = express();
app.use(cors());
const PORT = 3000;
const SELECTED_HOST = process.env.MOVIEBOX_API_HOST || "h5.aoneroom.com";
const HOST_URL = `https://${SELECTED_HOST}`;

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

let movieboxAppInfo = null;
let cookiesInitialized = false;
const DEFAULT = {
    'X-Client-Info': '{"timezone":"Africa/Nairobi"}',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept': 'application/json',
    'User-Agent': 'okhttp/4.12.0', // Mobile app user agent from PCAP
    'Referer': HOST_URL,
    'Host': SELECTED_HOST,
    'Connection': 'keep-alive',
    // Add IP spoofing headers to bypass region restrictions
    'X-Forwarded-For': '1.1.1.1',
    'CF-Connecting-IP': '1.1.1.1',
    'X-Real-IP': '1.1.1.1'
};

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

function processApiResponse(response) {
    if (response.data && response.data.data) {
        return response.data.data;
    }
    return response.data || response;
}

let sessionCookies = '';

async function ensureCookiesAreAssigned() {
    if (sessionCookies) return true;

    const response = await axiosInstance.get(
        `${HOST_URL}/wefeed-h5-bff/app/get-latest-app-pkgs?app_name=moviebox`,
        {
            headers: DEFAULT
        }
    );

    const setCookie = response.headers['set-cookie'];

    if (Array.isArray(setCookie)) {
        sessionCookies = setCookie
            .map(cookie => cookie.split(';')[0])
            .join('; ');
    }

    movieboxAppInfo = processApiResponse(response);

    return true;
}

async function makeApiRequestWithCookies(url, options = {}) {
    await ensureCookiesAreAssigned();

    const config = {
        ...options,
        url,
        headers: {
            ...DEFAULT_HEADERS,
            ...(sessionCookies
                ? { Cookie: sessionCookies }
                : {}),
            ...(options.headers || {})
        }
    };

    return axiosInstance(config);
}

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

app.get('/api/moviestream/:subject_id', async (req, res) => {
    const { subject_id } = req.params;
    const { detail_path, se = 1, ep = 1 } = req.query;
    const domData = await _makeRequest(`${API_BASE}/media-player/get-domain`);
    const domain = domData.data || 'https://netfilm.world';
    const playerReferer = `${domain}/spa/videoPlayPage/movies/${detail_path}?id=${subject_id}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
    const playUrl = `${domain}/wefeed-h5api-bff/subject/play?subjectId=${subject_id}&se=${se}&ep=${ep}&detailPath=${detail_path}`;
    const resp = await axios.get(playUrl, { headers: { ...PLAYER_HEADERS, Referer: playerReferer } });
    const data = resp.data.data;
    
    const hasResource = data.hasResource;
    const streams = data.streams.map(s => ({
        resolution: `${s.resolutions}p`,
        format: s.format,
        url: s.url,
        size: s.size,
        duration: s.duration,
        codec: s.codecName
    }));
    res.json({
        subject_id, se, ep, has_resource: hasResource, sources: streams, hls: data.hls, dash: data.dash, free_episodes: data.freeNum, limited: data.limited, note: hasResource ? null : 'No stream found for this episode.'
    });
});



app.get('/api/stream/:subject_id', async (req, res) => {
    try {
        const { subject_id } = req.params;

        // Movies use 0 for season and episode
        const se = parseInt(req.query.se) || 0;
        const ep = parseInt(req.query.ep) || 0;
        // 1. Get movie details
        const infoResponse = await makeApiRequestWithCookies(
            `${HOST_URL}/wefeed-h5-bff/web/subject/detail`,
            {
                method: 'GET',
                params: {
                    subjectId: subject_id
                }
            }
        );

        const movieInfo = processApiResponse(infoResponse);
        const detailPath = movieInfo?.subject?.detailPath;

        if (!detailPath) {
            throw new Error(
                'Could not get movie detail path for referer header'
            );
        }


        // 3. Build referer
        const refererUrl =
            `https://fmoviesunblocked.net/spa/videoPlayPage/movies/` +
            `${detailPath}?id=${subject_id}&type=/movie/detail`;


        // 4. Get downloads/sources
        const response = await makeApiRequestWithCookies(
            `${HOST_URL}/wefeed-h5-bff/web/subject/download`,
            {
                method: 'GET',
                params: {
                    subjectId: subject_id,
                    se,
                    ep
                },
                headers: {
                    Referer: refererUrl,
                    Origin: 'https://fmoviesunblocked.net'
                }
            }
        );

        const content = processApiResponse(response);

        // 5. Convert downloads to the response format you want
        const downloads = content?.downloads || [];

        const sources = downloads.map(file => ({
            resolution: `${file.resolution || 'Unknown'}p`,
            format: file.format || 'mp4',
            url: file.url,
            size: file.size,
            duration: file.duration,
            codec: file.codecName || file.codec
        }));

        const hasResource = sources.length > 0;

        // 6. Return the same format as your /api/stream endpoint
        res.json({
            subject_id,
            se,
            ep,
            has_resource: hasResource,
            sources,
            hls: content?.hls || null,
            dash: content?.dash || null,
            free_episodes: content?.freeNum || 0,
            limited: content?.limited || false,
            note: hasResource
                ? null
                : 'No stream found for this episode.'
        });

    } catch (error) {
        console.error(
            'MovieStream error:',
            error.message
        );

        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch streaming sources',
            error: error.message
        });
    }
});

app.get('/api/stream/:subject_id/captions', async (req, res) => {
    const { subject_id } = req.params;
    const { detail_path, se = 1, ep = 1 } = req.query;
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
    if (!streamId) return res.json({ subject_id, se, ep, count: 0, captions: [] });
    const capUrl = `${API_BASE}/subject/caption?format=${streamFormat}&id=${streamId}&subjectId=${subject_id}&detailPath=${detail_path}`;
    const data = await _makeRequest(capUrl);
    const inner = data.data;
    const captions = Array.isArray(inner) ? inner : inner.captions || [];
    res.json({ subject_id, se, ep, count: captions.length, captions });
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

export default app;
