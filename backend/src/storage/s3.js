'use strict';

// S3 storage driver. Same key format as the local driver, so switching is a config change
// and the two trees are interchangeable (ADR-0002).
//
// The AWS SDK is not a dependency of this package: nothing in the current sprints needs it,
// and CI must run without an AWS account. Install it when you flip STORAGE_DRIVER=s3:
//
//     npm install @aws-sdk/client-s3

const config = require('../config');

let client = null;
let sdk = null;

function load() {
  if (client) return { client, sdk };

  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    sdk = require('@aws-sdk/client-s3');
  } catch {
    throw new Error(
      'STORAGE_DRIVER=s3 requires the AWS SDK. Run: npm install @aws-sdk/client-s3'
    );
  }

  const { bucket, region, accessKey, secretKey, endpoint, forcePathStyle } = config.storage.s3;
  if (!bucket || !region) {
    throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET and S3_REGION');
  }

  client = new sdk.S3Client({
    region,
    // S3-compatible providers (Cloudflare R2, MinIO, Backblaze B2) need an explicit endpoint.
    ...(endpoint ? { endpoint, forcePathStyle: forcePathStyle || true } : {}),
    // Fall back to the ambient credential chain (IAM role, SSO) when keys are not supplied —
    // preferable to long-lived static keys in production.
    ...(accessKey && secretKey
      ? { credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } }
      : {}),
  });

  return { client, sdk };
}

async function put(key, buffer, contentType) {
  const { client: c, sdk: s } = load();
  await c.send(
    new s.PutObjectCommand({
      Bucket: config.storage.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Security checklist: screenshots/audio encrypted at rest. AWS S3 needs the header;
      // R2 and most S3-compatible stores encrypt at rest unconditionally and reject it.
      ...(config.storage.s3.endpoint ? {} : { ServerSideEncryption: 'AES256' }),
    })
  );
  return { key, size: buffer.length };
}

async function get(key) {
  const { client: c, sdk: s } = load();
  const res = await c.send(
    new s.GetObjectCommand({ Bucket: config.storage.s3.bucket, Key: key })
  );
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function remove(key) {
  const { client: c, sdk: s } = load();
  // DeleteObject is already idempotent in S3: deleting a missing key succeeds.
  await c.send(new s.DeleteObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }));
}

async function exists(key) {
  const { client: c, sdk: s } = load();
  try {
    await c.send(new s.HeadObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

module.exports = { name: 's3', put, get, remove, exists };
