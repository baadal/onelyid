import type { ServerResponse } from 'node:http'
import { Agent } from '@atproto/api'
import { OAuthServerAgent } from '@atproto/oauth-client-node'
import { getIronSession } from 'iron-session'
import type { Request, Response } from 'express'
import * as cookie from 'cookie'
import { addCookie, COOKIE_NAME_DID, COOKIE_NAME_SID, getBaseDomain, getHostname, getMainAuthDomain, isLocalHostname, isProductionEnv } from '@onelyid/common'
import { RequestContext, UserInfo, Session, IncomingMessageRequest, RespGlobals } from './types/common'
import * as Profile from '#/internal/generated/lexicon/types/app/bsky/actor/profile'
import * as Actor from '#/internal/generated/lexicon/types/app/bsky/actor/defs'
import dataTrusted from './data/trusted.json'

const errorLogger = (ctx: RequestContext) => (err: any) => {
  ctx.logger.error(err);
  return undefined;  // `void` return type interferes with intellisense
};

// Note: currently unused!
export async function readSession(
  req: IncomingMessageRequest,
  res: ServerResponse<IncomingMessageRequest>,
  cookieSecret: string,
) {
  const readonlySession = await getIronSession<Session>(req, res, {
    cookieName: COOKIE_NAME_SID,
    password: cookieSecret,
  })
  return readonlySession;
}

function sessionCookieDomain(req: IncomingMessageRequest) {
  const baseDomainObj = getBaseDomain(req)
  const mainAuthDomain = getMainAuthDomain(req)

  let cookieDomain = baseDomainObj ? baseDomainObj.baseDomain : undefined
  if (cookieDomain === mainAuthDomain || baseDomainObj?.isLocalhost || !baseDomainObj?.isVerified) {
    cookieDomain = undefined; // Host-only cookie
  }
  if (cookieDomain) {
    cookieDomain = `.${cookieDomain}` // Not needed for modern browsers
  }
  return cookieDomain
}

function addDidCookie(req: IncomingMessageRequest, res: ServerResponse, opts: { maxAgeSecs: number, value?: string }) {
  const hostname = getHostname(req)
  const isLocalhost = isLocalHostname(hostname)
  const cookieDomain = sessionCookieDomain(req)

  // Note: A cookie is uniquely identified by (name, domain, path)
  addCookie(res, cookie.stringifySetCookie({
    name: COOKIE_NAME_DID,
    value: opts.value ?? '',
    domain: cookieDomain,
    path: '/',
    secure: !isLocalhost && isProductionEnv(),
    sameSite: 'lax',
    httpOnly: true,
    maxAge: opts.maxAgeSecs,
  }))
}

export async function getSession(
  req: IncomingMessageRequest,
  res: ServerResponse<IncomingMessageRequest>,
  cookieSecret: string,
) {
  const hostname = getHostname(req)
  const isLocalhost = isLocalHostname(hostname)
  const cookieDomain = sessionCookieDomain(req)

  // Note: A cookie is uniquely identified by (name, domain, path)
  const session = await getIronSession<Session>(req, res, {
    cookieName: COOKIE_NAME_SID,
    password: cookieSecret,
    cookieOptions: { // NOTE: the same cookie options are used for cookie deletion also
      domain: cookieDomain,
      path: '/',
      secure: !isLocalhost && isProductionEnv(),
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    }
  })
  return session;
}

export async function setSession(
  req: IncomingMessageRequest,
  res: ServerResponse<IncomingMessageRequest>,
  cookieSecret: string,
  session: any,
) {
  if (!session) return
  const clientSession = await getSession(req, res, cookieSecret);
  // assert(!clientSession.did, 'session already exists')
  if (session.did) clientSession.did = session.did
  await clientSession.save()

  if (session.did) {
    addDidCookie(req, res, {
      value: session.did,
      maxAgeSecs: 60 * 60 * 24 * 7, // 7 days
    })
  }
}

export async function deleteSession(req: Request, res: Response, globals: RespGlobals) {
  // Deletes the session cookie
  // NOTE: Currently, we don't delete the auth session record in the DB
  const session = await getSession(req, res, globals.cookieSecret);
  const sessionExists = session.did
  await session.destroy()

  if (sessionExists) {
    addDidCookie(req, res, {
      maxAgeSecs: 0, // expire immediately (delete cookie)
    })
  }
}

// Helper function to get the Atproto Agent for the active session
export async function getSessionAgent(
  req: IncomingMessageRequest,
  res: ServerResponse<IncomingMessageRequest>,
  cookieSecret: string,
): Promise<{ agent?: Agent | null, issuer?: string, error?: string }> {
  const session = await getSession(req, res, cookieSecret);
  if (!session.did) {
    if (req.headers.cookie) {
      const cookies = cookie.parse(req.headers.cookie)
      if (cookies[COOKIE_NAME_SID]) {
        await session.destroy()
      }
    }
    return { agent: null }
  }

  try {
    const oauthSession = await req.ctx.oauthClient.restore(session.did)

    let issuer: OAuthServerAgent['issuer'] | null = oauthSession.server.issuer;
    if (!issuer || issuer !== oauthSession.serverMetadata.issuer) {
      return { error: 'invalid issuer' }
    }

    const agent = oauthSession ? new Agent(oauthSession) : null
    return { agent, issuer }
  } catch (err) {
    const error = 'oauth restore failed'
    req.ctx.logger.error(error, err)
    await session.destroy()
    return { error }
  }
}

// Helper function to get the AppView Agent (defaults to Bluesky AppView)
export function getAppViewAgent(appViewUrl?: string) {
  /*
    NOTE `https://public.api.bsky.app` is a more cached (read-only) version of Bluesky AppView
    which is okay for raw cURL requests
    e.g. curl "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=abraj.dev" | jq
    --
    For SDKs, using `https://api.bsky.app` is preferred
   */
  const service = appViewUrl || 'https://api.bsky.app'
  const appViewAgent = new Agent({ service });
  return appViewAgent
}

export async function getSessionUser(
    req: IncomingMessageRequest,
    res: ServerResponse<IncomingMessageRequest>,
    cookieSecret: string,
): Promise<{ user?: UserInfo | null, error?: string }> {
  // If the user is signed in, get an agent which communicates with their server
  const { agent, issuer } = await getSessionAgent(req, res, cookieSecret);

  if (!agent || !issuer) {
    return { user: null }
  }

  const issuerTrusted = dataTrusted.trustedIssuers.includes(issuer)

  // Fetch user info (current auth session)
  const userSessionPr = agent.com.atproto.server.getSession().catch(errorLogger(req.ctx));

  // Fetch additional information about the logged-in user
  // const profilePr = getProfileFromPds(agent.assertDid, agent, req.ctx)
  const profilePr = getProfileFromAppView(agent.assertDid, req.ctx)

  const [userSession, profile] = await Promise.all([userSessionPr, profilePr]);
  const userInfo = userSession?.data;

  const handle = userInfo?.handle;
  const email = userInfo?.email;
  const emailConfirmed = userInfo?.emailConfirmed;
  const displayName = profile?.displayName ?? '';

  // TODO: email verification in case of untrusted issuer
  const emailVerified = !!(issuerTrusted && emailConfirmed);

  let avatar = ''
  if (profile?.avatar) {
    if (typeof profile.avatar == 'string') {
      // [AppView]
      avatar = profile.avatar
    } else {
      // [PDS]
      // avatar = 'BlobRef{ref,mimeType,size,original}'
    }
  }

  if (!handle) {
    const error = 'handle missing'
    req.ctx.logger.error(error)
    req.ctx.logger.warn('userSession:', userSession)
    return { error }
  }

  if (!email || !emailConfirmed) {
    const error = 'no verified email found'
    req.ctx.logger.error(error)
    req.ctx.logger.warn('email:', email, `[${emailConfirmed}]`)
    req.ctx.logger.warn('user:', { did: agent.assertDid, handle, displayName })
    return { error }
  }

  const profileData: UserInfo = {
    did: agent.assertDid,
    handle,
    email,
    emailVerified,
    displayName,
    avatar,
    // profile.createdAt
    // profile.description
  };

  return { user: profileData }
}

async function getProfileFromPds(did: string, agent: Agent, ctx: RequestContext) {
  const profileResponse = await agent.com.atproto.repo.getRecord({
    repo: did,
    collection: 'app.bsky.actor.profile',
    rkey: 'self',
  }).catch(errorLogger(ctx));
  const profileRecord = profileResponse?.data;

  // Validate profile record
  let profile: Profile.Record | null = null
  if (profileRecord && Profile.isRecord(profileRecord.value)) {
    const validateResult = Profile.validateRecord(profileRecord.value)
    if (validateResult.success) {
      profile = profileRecord.value
    } else {
      ctx.logger.error('[getSessionUser] Unable to validate profileRecord!');
    }
  }

  // // Get raw image bytes and create image file yourself
  // if (profile?.avatar) {
  //   const blobResponse = await agent.com.atproto.sync.getBlob({
  //     did: agent.assertDid,
  //     cid: profile.avatar.ref.toString(),
  //   }).catch(errorLogger(ctx))
  //   if (blobResponse) {
  //     const bytes: Uint8Array = blobResponse.data
  //     const contentType = blobResponse.headers['content-type']
  //     const buffer = Buffer.from(bytes)
  //     const ext = contentType === 'image/png'
  //       ? 'png'
  //       : contentType === 'image/jpeg'
  //         ? 'jpg'
  //         : 'bin'
  //     const fileName = `avatar.${ext}`
  //     // import { writeFile } from 'node:fs/promises'
  //     await writeFile(fileName, buffer)  // can also pass `bytes` directly here
  //   }
  // }

  return profile
}

async function getProfileFromAppView(did: string, ctx: RequestContext) {
  const appViewAgent = getAppViewAgent();

  const profileResponse = await appViewAgent.app.bsky.actor.getProfile({
    actor: did,
  }).catch(errorLogger(ctx));
  const profileRecord = profileResponse?.data;

  // Validate profile record
  let profile: Actor.ProfileViewDetailed | null = null
  if (profileRecord) {
    if (!profileRecord.$type) {
      profileRecord.$type = 'app.bsky.actor.defs#profileViewDetailed'
    }
    if (Actor.isProfileViewDetailed(profileRecord)) {
      const validateResult = Actor.validateProfileViewDetailed(profileRecord)
      if (validateResult.success) {
        profile = profileRecord
      } else {
        ctx.logger.error('[getSessionUser] Unable to validate profileRecord!');
      }
    }
  }

  return profile
}

/*
# -------
# OAuthSession:
{
  server: OAuthServerAgent {
    authMethod: { method: 'none' },
    dpopKey: JoseKey {
      jwk: [Object],
      'get algorithms': [Getter],
      'get isSymetric': [Getter],
      'get bareJwk': [Getter],
      'get isPrivate': [Getter]
    },
    serverMetadata: {
      issuer: 'https://bsky.social',
      request_parameter_supported: true,
      request_uri_parameter_supported: true,
      require_request_uri_registration: true,
      scopes_supported: [Array],
      subject_types_supported: [Array],
      response_types_supported: [Array],
      response_modes_supported: [Array],
      grant_types_supported: [Array],
      code_challenge_methods_supported: [Array],
      ui_locales_supported: [Array],
      display_values_supported: [Array],
      request_object_signing_alg_values_supported: [Array],
      authorization_response_iss_parameter_supported: true,
      request_object_encryption_alg_values_supported: [],
      request_object_encryption_enc_values_supported: [],
      jwks_uri: 'https://bsky.social/oauth/jwks',
      authorization_endpoint: 'https://bsky.social/oauth/authorize',
      token_endpoint: 'https://bsky.social/oauth/token',
      token_endpoint_auth_methods_supported: [Array],
      token_endpoint_auth_signing_alg_values_supported: [Array],
      revocation_endpoint: 'https://bsky.social/oauth/revoke',
      pushed_authorization_request_endpoint: 'https://bsky.social/oauth/par',
      require_pushed_authorization_requests: true,
      dpop_signing_alg_values_supported: [Array],
      client_id_metadata_document_supported: true,
      prompt_values_supported: [Array]
    },
    clientMetadata: {
      redirect_uris: [Array],
      response_types: [Array],
      grant_types: [Array],
      scope: 'atproto transition:generic transition:email',
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      subject_type: 'public',
      authorization_signed_response_alg: 'RS256',
      client_id: 'http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A5500%2F%40onelyid%2Fclient%2Fcallback&scope=atproto%20transition%3Ageneric%20transition%3Aemail',
      client_name: 'ATProto client',
      client_uri: 'http://127.0.0.1:5500',
      dpop_bound_access_tokens: true
    },
    dpopNonces: SimpleStoreMemory {},
    oauthResolver: OAuthResolver {
      identityResolver: [AtprotoIdentityResolver],
      protectedResourceMetadataResolver: [OAuthProtectedResourceMetadataResolver],
      authorizationServerMetadataResolver: [OAuthAuthorizationServerMetadataResolver]
    },
    runtime: Runtime {
      implementation: [Object],
      hasImplementationLock: true,
      usingLock: [Function: bound ] AsyncFunction
    },
    keyset: undefined,
    dpopFetch: [AsyncFunction (anonymous)],
    clientCredentialsFactory: [Function (anonymous)]
  },
  sub: 'did:plc:4podqwoafivhmszrb7ctl4b7',
  sessionGetter: SessionGetter {
    getter: [AsyncFunction (anonymous)],
    store: {
      set: [AsyncFunction: set],
      get: [AsyncFunction: get],
      del: [Function: bound del] AsyncFunction,
      clear: undefined
    },
    options: {
      isStale: [Function: isStale],
      onStoreError: [AsyncFunction: onStoreError],
      deleteOnError: [AsyncFunction: deleteOnError]
    },
    pending: Map(0) {},
    runtime: Runtime {
      implementation: [Object],
      hasImplementationLock: true,
      usingLock: [Function: bound ] AsyncFunction
    },
    eventTarget: CustomEventTarget { eventTarget: EventTarget }
  },
  dpopFetch: [AsyncFunction (anonymous)]
}
# -------
# userInfo:
{
  "handle": "abraj.dev",
  "did": "did:plc:4podqwoafivhmszrb7ctl4b7",
  "didDoc": {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
      "https://w3id.org/security/suites/secp256k1-2019/v1"
    ],
    "id": "did:plc:4podqwoafivhmszrb7ctl4b7",
    "alsoKnownAs": [
      "at://abraj.dev"
    ],
    "verificationMethod": [
      {
        "id": "did:plc:4podqwoafivhmszrb7ctl4b7#atproto",
        "type": "Multikey",
        "controller": "did:plc:4podqwoafivhmszrb7ctl4b7",
        "publicKeyMultibase": "zQ3shhSr24qyq5YSitSWCYuN1To7aPAPm5fAj2sun7h9ct6gd"
      }
    ],
    "service": [
      {
        "id": "#atproto_pds",
        "type": "AtprotoPersonalDataServer",
        "serviceEndpoint": "https://blewit.us-west.host.bsky.network"
      }
    ]
  },
  "email": "abhi@raj.me",
  "emailConfirmed": true,
  "emailAuthFactor": true,
  "active": true
}
# -------
# profile: [PDS]
{
  "$type": "app.bsky.actor.profile",
  "avatar": BlobRef {
    "$type": "blob",
    "ref": CID {
      "$link": "bafkreielylpnwizly4ey7wase2m7igmntlkt2bfp5erj76kppalnfmhcfe"
    },
    "mimeType": "image/jpeg",
    "size": 23192,
    "original": {
      '$type': 'blob',
      ref: CID(bafkreielylpnwizly4ey7wase2m7igmntlkt2bfp5erj76kppalnfmhcfe),
      mimeType: 'image/jpeg',
      size: 23192
    }
  },
  "createdAt": "2024-09-08T21:05:38.291Z",
  "description": "",
  "displayName": "abraj"
}
# -------
# profile: [AppView]
{
  did: 'did:plc:4podqwoafivhmszrb7ctl4b7',
  handle: 'abraj.dev',
  displayName: 'abraj',
  avatar: 'https://cdn.bsky.app/img/avatar/plain/did:plc:4podqwoafivhmszrb7ctl4b7/bafkreielylpnwizly4ey7wase2m7igmntlkt2bfp5erj76kppalnfmhcfe@jpeg',
  associated: {
    lists: 0,
    feedgens: 0,
    starterPacks: 0,
    labeler: false,
    activitySubscription: { allowSubscriptions: 'followers' }
  },
  labels: [],
  createdAt: '2024-09-08T21:05:40.027Z',
  indexedAt: '2024-12-25T13:40:05.043Z',
  followersCount: 22,
  followsCount: 20,
  postsCount: 0
}
# -------
*/
