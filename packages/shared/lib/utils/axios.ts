import axios from 'axios';
import type { Agent } from 'node:https';
import https from 'node:https';

import { HttpsProxyAgent } from 'https-proxy-agent';

export let httpAgent: HttpsProxyAgent<string> | Agent | undefined = undefined;

const httpsProxy = process.env['HTTPS_PROXY'];

if (httpsProxy) {
    httpAgent = new HttpsProxyAgent(httpsProxy);
} else {
    httpAgent = new https.Agent();
}

export const axiosInstance = axios.create({
    httpAgent: httpAgent,
    httpsAgent: httpAgent
});
