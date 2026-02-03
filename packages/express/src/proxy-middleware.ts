import type { Request, Response, NextFunction} from 'express';
import https from 'node:https';
import http from 'node:http';
import { getAuthClientMountPath, getAuthOrigin, getCustomHeaderNames, getMainAuthDomain, getOrigin } from '@onelyid/common';

const authClientMountPath = getAuthClientMountPath()
const authProxyPaths = [
  // '/',
  // '/public/styles.css',
  // '/login',
  // '/logout',
  '/oauth-client-metadata.json',
  `${authClientMountPath}/login/redirect`,
  `${authClientMountPath}/login`,
  `${authClientMountPath}/callback`,
  `${authClientMountPath}/transfer-local-session`,
  `${authClientMountPath}/userinfo`,
  `${authClientMountPath}/logout`,
];

export const authProxyMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const cond1 = authProxyPaths.includes(req.path)
  if (!cond1) {
    // console.log(`[OK] No Proxy url`);
    return next()
  }

  const origin = getOrigin(req)
  const authOriginObj = getAuthOrigin(req)
  const cond2 = (origin && origin === authOriginObj?.authOrigin) || authOriginObj?.isLocalhost
  // NOTE: Do not combine `cond1` and `cond2`, otherwise `getAuthOrigin()` will be executed for
  // non-authproxy URLs (e.g. /favicon.ico) causing error: "Request mode not set!"
  if (!cond2) {
    // console.log(`[OK] No Proxy auth origin`);
    return next()
  }

  // console.log(`[Proxy] ${req.method} ${req.url}`);

  if (!authOriginObj?.isLocalhost && req.protocol !== 'https') {
    return res.json({
      error: 'http protocol not supported! use https',
      message: '\'trust proxy\' must be enabled for express, so that `req.protocol` is set correctly'
    })
  }

  const mainAuthDomain = getMainAuthDomain(req)
  const authProxyTargetOrigin = `https://${mainAuthDomain}`;

  // Parse the target URL
  const targetUrl = new URL(req.url, authProxyTargetOrigin);

  // Choose http or https module based on 'target url' protocol
  const client = targetUrl.protocol === 'https:' ? https : http;

  const customHeaders = getCustomHeaderNames()

  // Prepare request options
  const options = {
    hostname: targetUrl.hostname, // TCP target
    servername: targetUrl.hostname, // TLS SNI (optional, otherwise defaults to headers.host)
    port: targetUrl.port,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.hostname, // Override host header
      [customHeaders.proxyOrigin]: `${req.protocol}://${req.get('host')}`
    },
  };

  // Approach 2: (Step 1/2)
  let body = ''
  if (req.body) {
    body = new URLSearchParams(req.body).toString();
    options.headers['content-length'] = String(Buffer.byteLength(body));
  }

  // Make the request to the target server
  const proxyReq = client.request(options, (proxyRes) => {
    // Forward status code
    res.status(proxyRes.statusCode ?? 500);

    // Forward headers
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      res.setHeader(k, v as string);
    });

    // Pipe the response back to client
    proxyRes.pipe(res);
  });

  // Handle errors
  proxyReq.on('error', (err) => {
    req.ctx.logger.error('Proxy error:', err);
    res.status(500).send('Proxy error');
  });

  // Pipe the request body (for POST, PUT, etc.)
  if (!req.body) {
    // Approach 1 (Does not work if body/stream is already consumed by a body parser earlier)
    req.pipe(proxyReq);
  } else {
    // Approach 2: (Step 2/2)
    proxyReq.write(body);
    proxyReq.end();
  }
};
