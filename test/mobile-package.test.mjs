import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

test('mobile package is installable and uses the production web bundle', async () => {
  const config = (await import('../capacitor.config.ts')).default;
  assert.deepEqual({ appId: config.appId, appName: config.appName, webDir: config.webDir }, {
    appId: 'in.handoff.recovery', appName: 'Handoff Field', webDir: 'dist',
  });

  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  const pngIcons = manifest.icons.filter((icon) => icon.type === 'image/png');
  assert.deepEqual(pngIcons.map((icon) => icon.sizes), ['192x192', '512x512', '512x512']);
  for (const icon of pngIcons) {
    const path = join('public', icon.src.replace(/^\//, ''));
    assert.equal(statSync(path).size > 0, true);
    const bytes = readFileSync(path);
    const expected = Number(icon.sizes.split('x')[0]);
    assert.equal(bytes.readUInt32BE(16), expected);
    assert.equal(bytes.readUInt32BE(20), expected);
  }

  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(packageJson.dependencies['@capacitor/core'], /^8\./);
  assert.match(packageJson.dependencies['@capacitor/android'], /^8\./);
  assert.match(packageJson.devDependencies['@capacitor/cli'], /^8\./);
  assert.equal(packageJson.scripts['mobile:sync'], 'npm run build && cap sync android');

  const gradle = readFileSync('android/app/build.gradle', 'utf8');
  const variables = readFileSync('android/variables.gradle', 'utf8');
  const androidManifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.match(gradle, /applicationId "in\.handoff\.recovery"/);
  assert.match(variables, /minSdkVersion = 24/);
  assert.match(androidManifest, /android\.permission\.INTERNET/);
  assert.match(androidManifest, /android\.permission\.ACCESS_FINE_LOCATION/);
});
