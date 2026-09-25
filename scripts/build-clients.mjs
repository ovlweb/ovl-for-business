#!/usr/bin/env node
/**
 * Builds the OVL For Business apps for your server, on Linux, macOS or Windows:
 *
 *   web, admin   the web client and the admin panel, as static files for any web host (every system)
 *   android      the Android app (every system)
 *   ios, macos   the iPhone/iPad and Mac apps (on a Mac with Xcode)
 *   windows      the Windows app (on Windows with the Visual Studio C++ tools)
 *   linux        the Linux app (on Linux)
 *
 * Start it with the wrapper for your system, which installs Node.js first when it is missing:
 *
 *   ./build-clients.sh      Linux, macOS
 *   build-clients.cmd       Windows (double-click it, or run it in a terminal)
 *
 * It asks for your server's address and what to build, offers to install what is missing (pnpm,
 * Flutter, Java, the Android SDK, build packages), and puts the results in dist/clients with a
 * SHA256SUMS.txt. All questions come first, then it builds without asking. `--help` lists the options
 * for unattended builds.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split('.').map(Number);
if (NODE_MAJOR < 22 || (NODE_MAJOR === 22 && NODE_MINOR < 12)) {
  console.error(
    `Node.js 22.12 or newer is needed (this is ${process.version}). ` +
      'Start ./build-clients.sh or build-clients.cmd instead: they install it.',
  );
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'clients', 'app');
/** Tools this script installs (Flutter, the Android SDK, the Android release key) live here. */
const TOOLS = path.join(os.homedir(), '.ovl');
const HOST = process.platform;
const WINDOWS = HOST === 'win32';
const EXE = WINDOWS ? '.exe' : '';
const HOST_NAME = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' }[HOST] ?? HOST;
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
/** The Flutter release the apps are built and tested with in CI. */
const FLUTTER_VERSION =
  /FLUTTER_VERSION:\s*([\d.]+)/.exec(read('.github/workflows/native.yml') ?? '')?.[1] ?? '3.47.5';
/** Android command-line tools (sdkmanager); they update themselves. */
const ANDROID_TOOLS = '11076708';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const yellow = paint('33');
const red = paint('31');

const USAGE = `Build the OVL For Business apps for your server.

Usage: build-clients [TARGET…] [options]

Targets: web admin android ios macos windows linux, or all (everything this computer can build).
Without targets, it asks.

Options:
  --api-url URL       Address of your server, e.g. https://business.example.com
                      (default: PUBLIC_WEB_URL from the .env that setup.sh wrote, if there is one)
  --out DIR           Where to put the builds (default: dist/clients)
  --build-number N    Build number of the native apps; app stores need a higher one for every upload
  --yes, -y           Ask nothing: use the defaults and install what is missing
  --list              Show what this computer can build, and exit
  --help, -h          This help

Examples:
  ./build-clients.sh
  ./build-clients.sh web admin android --api-url https://business.example.com --yes
  build-clients.cmd windows android --api-url https://business.example.com`;

// ---------------------------------------------------------------------------------------------------
// Small helpers

function read(file) {
  try {
    return fs.readFileSync(path.resolve(ROOT, file), 'utf8');
  } catch {
    return null;
  }
}

const say = (text = '') => console.log(text);
const warn = (text) => console.log(yellow(`! ${text}`));
const heading = (text) => console.log(`\n${bold(`== ${text}`)}`);
const tilde = (file) => (file.startsWith(os.homedir()) ? `~${file.slice(os.homedir().length)}` : file);
/** A path as short as it gets: relative to where you are when it is below it. */
const shown = (file) => {
  const rel = path.relative(process.cwd(), file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : tilde(file);
};

const isProgram = (file) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** The full path of a program on PATH, or null. */
function which(name) {
  const exts = WINDOWS && !path.extname(name) ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir.replace(/^"|"$/g, ''), name + ext.toLowerCase());
      // stat() fails on the app aliases in WindowsApps (winget.exe), which do run.
      if (WINDOWS ? fs.existsSync(file) : isProgram(file)) return file;
    }
  }
  return null;
}

/** cmd.exe runs .bat and .cmd files; everything else starts directly. */
function spawn(cmd, args, options) {
  if (WINDOWS && /\.(bat|cmd)$/i.test(cmd)) {
    const quote = (a) => (/^[\w./:=@\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
    return spawnSync([cmd, ...args].map(quote).join(' '), { ...options, shell: true });
  }
  return spawnSync(cmd, args, options);
}

/** Runs a command with its output on screen; true when it succeeds. */
function run(cmd, args, { cwd = ROOT, env = {}, input, secret } = {}) {
  const line = [path.basename(cmd), ...args]
    .map((a) => (secret && a === secret ? '••••' : /\s/.test(a) ? JSON.stringify(a) : a))
    .join(' ');
  console.log(dim(`$ ${line}`));
  const result = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    input,
  });
  if (result.error) console.log(red(`${path.basename(cmd)} did not start: ${result.error.message}`));
  return result.status === 0;
}

/** What a command prints (stdout and stderr), or null when it can't run or fails. */
function output(cmd, args, { cwd = ROOT, env = {} } = {}) {
  const result = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 600_000,
  });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function must(ok, message) {
  if (!ok) throw new Error(message);
}

const subdirs = (dir) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name))
      .sort()
      .reverse();
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------------------------------
// Questions (only in a terminal and without --yes; otherwise the defaults)

let interactive = false;

async function prompt(text) {
  // A readline interface keeps the terminal in raw mode, so it is closed before anything else runs.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(text)).trim();
  } finally {
    rl.close();
  }
}

async function ask(question, fallback = '') {
  if (!interactive) return fallback;
  return (await prompt(`${question}${fallback ? ` [${fallback}]` : ''}: `)) || fallback;
}

async function confirm(question, yes = true) {
  if (!interactive) return yes;
  for (;;) {
    const answer = (await prompt(`${question} ${yes ? '[Y/n]' : '[y/N]'} `)).toLowerCase();
    if (!answer) return yes;
    if (/^[yд]/.test(answer)) return true;
    if (/^[nн]/.test(answer)) return false;
    say('Please answer y or n.');
  }
}

// ---------------------------------------------------------------------------------------------------
// Archives: .zip (web, admin, Windows) and .tar.gz (Linux), without extra tools

/** Every file and folder under dir, folders first, with "/" separated relative names. */
function listTree(dir, prefix = '') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      const rel = prefix + entry.name;
      const stat = fs.lstatSync(full);
      return stat.isDirectory() ? [{ rel, full, stat }, ...listTree(full, `${rel}/`)] : [{ rel, full, stat }];
    });
}

const dosTime = (d) => [
  (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
];

/** Zips the files under dir (at the top of the zip, or inside top/). */
function writeZip(dir, file, top = '') {
  const parts = [];
  const central = [];
  let offset = 0;
  let count = 0;
  for (const { rel, full, stat } of listTree(dir)) {
    if (!stat.isFile()) continue;
    const name = Buffer.from(top ? `${top}/${rel}` : rel);
    const data = fs.readFileSync(full);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = zlib.crc32(data);
    const [time, date] = dosTime(stat.mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(0x0314, 4); // made on Unix, so the file modes below count
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(((WINDOWS ? 0o100644 : stat.mode) & 0xffff) * 0x10000, 38);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, name, body);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
    count++;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, ...central, end]));
}

/** A .tar.gz of dir, inside top/, keeping file modes and links. */
function writeTarGz(dir, file, top) {
  const blocks = [];
  const field = (h, at, length, value) => h.write(value, at, length);
  const octal = (h, at, length, n) => field(h, at, length, `${n.toString(8).padStart(length - 1, '0')}\0`);
  const header = (name, stat, type, size = 0, link = '') => {
    let prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const cut = [...name.matchAll(/\//g)]
        .map((m) => m.index)
        .find(
          (i) => Buffer.byteLength(name.slice(0, i)) <= 155 && Buffer.byteLength(name.slice(i + 1)) <= 100,
        );
      if (cut === undefined) throw new Error(`The path is too long for a tar file: ${name}`);
      [prefix, name] = [name.slice(0, cut), name.slice(cut + 1)];
    }
    const h = Buffer.alloc(512);
    field(h, 0, 100, name);
    octal(h, 100, 8, stat.mode & 0o7777);
    octal(h, 108, 8, 0);
    octal(h, 116, 8, 0);
    octal(h, 124, 12, size);
    octal(h, 136, 12, Math.floor(stat.mtimeMs / 1000));
    h.fill(' ', 148, 156);
    field(h, 156, 1, type);
    field(h, 157, 100, link);
    field(h, 257, 6, 'ustar\0');
    field(h, 263, 2, '00');
    field(h, 345, 155, prefix);
    field(
      h,
      148,
      8,
      `${h
        .reduce((sum, b) => sum + b, 0)
        .toString(8)
        .padStart(6, '0')}\0 `,
    );
    return h;
  };
  blocks.push(header(`${top}/`, fs.statSync(dir), '5'));
  for (const { rel, full, stat } of listTree(dir)) {
    const name = `${top}/${rel}`;
    if (stat.isDirectory()) blocks.push(header(`${name}/`, stat, '5'));
    else if (stat.isSymbolicLink()) blocks.push(header(name, stat, '2', 0, fs.readlinkSync(full)));
    else {
      const data = fs.readFileSync(full);
      blocks.push(
        header(name, stat, '0', data.length),
        data,
        Buffer.alloc((512 - (data.length % 512)) % 512),
      );
    }
  }
  blocks.push(Buffer.alloc(1024));
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat(blocks), { level: 9 }));
}

function download(url, file) {
  const curl = which('curl');
  if (curl) return run(curl, ['-fL', '--retry', '3', '--progress-bar', '-o', file, url]);
  const wget = which('wget');
  if (wget) return run(wget, ['-O', file, url]);
  console.log(red('Downloading needs curl or wget.'));
  return false;
}

function unzip(archive, dest) {
  if (WINDOWS)
    return run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), [
      '-xf',
      archive,
      '-C',
      dest,
    ]);
  if (which('unzip')) return run('unzip', ['-q', '-o', archive, '-d', dest]);
  if (HOST === 'darwin') return run('ditto', ['-x', '-k', archive, dest]);
  if (which('python3')) return run('python3', ['-m', 'zipfile', '-e', archive, dest]);
  console.log(red('Unpacking needs unzip (or python3).'));
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Installing system packages (with the user's agreement)

const IS_ROOT = process.getuid?.() === 0;

function linuxInstaller() {
  const managers = [
    ['apt-get', ['install', '-y']],
    ['dnf', ['install', '-y']],
    ['yum', ['install', '-y']],
    ['zypper', ['--non-interactive', 'install']],
    ['pacman', ['-S', '--needed', '--noconfirm']],
  ];
  const found = managers.find(([name]) => which(name));
  return found ? { name: found[0], install: found[1], family: found[0] === 'yum' ? 'dnf' : found[0] } : null;
}

/** Installs Linux packages ({ 'apt-get': [...], dnf: [...], zypper: [...], pacman: [...] }). */
async function installLinuxPackages(what, packages) {
  const pm = linuxInstaller();
  const list = pm && (typeof packages === 'function' ? packages(pm.family) : packages[pm.family]);
  if (!list) {
    warn(`Install ${what} with your package manager, then run this again.`);
    return false;
  }
  const sudo = IS_ROOT ? [] : which('sudo') ? ['sudo'] : null;
  if (!sudo) {
    warn(`Installing ${what} needs root: run as root  ${pm.name} ${pm.install.join(' ')} ${list.join(' ')}`);
    return false;
  }
  const command = [...sudo, pm.name, ...pm.install, ...list];
  if (!(await confirm(`Install ${what} now?\n  ${command.join(' ')}\n`))) return false;
  if (pm.name === 'apt-get') run(command[0], [...command.slice(1, sudo.length + 1), 'update']);
  return run(command[0], command.slice(1));
}

async function winget(what, id, extra = []) {
  const bin = which('winget');
  if (!bin) {
    warn(`Install ${what}, then run this again (winget, which could install it, is not available).`);
    return false;
  }
  if (!(await confirm(`Install ${what} now with winget?`))) return false;
  return run(bin, [
    'install',
    '--id',
    id,
    '-e',
    '--source',
    'winget',
    '--accept-package-agreements',
    '--accept-source-agreements',
    ...extra,
  ]);
}

async function brew(what, args) {
  const bin = which('brew');
  if (!bin) {
    warn(`Install ${what}, then run this again (for example with Homebrew: brew install ${args.join(' ')}).`);
    return false;
  }
  if (!(await confirm(`Install ${what} now?\n  brew install ${args.join(' ')}\n`))) return false;
  return run(bin, ['install', ...args]);
}

// ---------------------------------------------------------------------------------------------------
// The tools each target needs

const cache = new Map();
/** Each check or installation runs once, even when several targets need it. */
const once = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
};

// pnpm, for the web client and the admin panel.
function findPnpm() {
  const wanted = JSON.parse(read('package.json')).packageManager?.split('@')[1] ?? '10';
  const own = which('pnpm');
  if (own && output(own, ['--version'])?.trim().split('.')[0] === wanted.split('.')[0]) return [own];
  const corepack = which('corepack');
  if (corepack) return [corepack, 'pnpm'];
  const npx = which('npx');
  return npx ? [npx, '--yes', `pnpm@${wanted}`] : null;
}

const pnpmEnv = { COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };

// Flutter, for the native apps.
const FLUTTER_BIN = WINDOWS ? 'flutter.bat' : 'flutter';
const ownFlutter = path.join(TOOLS, 'flutter');

function findFlutter() {
  const candidates = [
    which('flutter'),
    process.env.FLUTTER_ROOT && path.join(process.env.FLUTTER_ROOT, 'bin', FLUTTER_BIN),
    path.join(ownFlutter, 'bin', FLUTTER_BIN),
  ];
  return candidates.find((file) => file && fs.existsSync(file)) ?? null;
}

async function ensureGit() {
  if (which('git')) return true;
  say('Git is needed to download Flutter.');
  if (WINDOWS) {
    if (!(await winget('Git', 'Git.Git'))) return false;
    process.env.PATH = `${path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd')};${process.env.PATH}`;
  } else if (HOST === 'darwin') {
    warn(
      'Install the Xcode command-line tools (they include Git): xcode-select --install, then run this again.',
    );
    return false;
  } else if (
    !(await installLinuxPackages('Git', {
      'apt-get': ['git'],
      dnf: ['git'],
      zypper: ['git'],
      pacman: ['git'],
    }))
  ) {
    return false;
  }
  return Boolean(which('git'));
}

const ensureFlutter = () =>
  once('flutter', async () => {
    let flutter = findFlutter();
    if (!flutter) {
      say('The native apps are built with Flutter, which is not installed.');
      if (
        !(await confirm(
          `Download Flutter ${FLUTTER_VERSION} into ${tilde(ownFlutter)}? (about 2 GB with its tools)`,
        ))
      ) {
        throw new Error('Flutter is needed: https://docs.flutter.dev/get-started/install');
      }
      if (!(await ensureGit())) throw new Error('Git is needed to download Flutter.');
      fs.rmSync(ownFlutter, { recursive: true, force: true });
      fs.mkdirSync(TOOLS, { recursive: true });
      const url = 'https://github.com/flutter/flutter.git';
      must(
        run('git', ['clone', '--depth', '1', '--branch', FLUTTER_VERSION, url, ownFlutter]),
        'Flutter could not be downloaded.',
      );
      flutter = path.join(ownFlutter, 'bin', FLUTTER_BIN);
      // The first start downloads the Dart SDK.
      must(run(flutter, ['--version']), 'Flutter did not start; the messages above say why.');
    }
    const machine = output(flutter, ['--version', '--machine']);
    let version = null;
    try {
      version = JSON.parse(
        machine.slice(machine.indexOf('{'), machine.lastIndexOf('}') + 1),
      ).frameworkVersion;
    } catch {
      // Once more with its messages on screen, so they say why.
      run(flutter, ['--version'], { cwd: APP });
      throw new Error(`Flutter (${tilde(flutter)}) did not start; the messages above say why.`);
    }
    say(`Flutter ${version} ${dim(`(${tilde(path.dirname(path.dirname(flutter)))})`)}`);
    const series = (v) => v.split('.').slice(0, 2).join('.');
    if (series(version) !== series(FLUTTER_VERSION)) {
      warn(
        `The apps are tested with Flutter ${FLUTTER_VERSION}. If the build fails, remove this Flutter from PATH`,
      );
      warn(`and this script downloads ${FLUTTER_VERSION} into ${tilde(ownFlutter)}.`);
    }
    return flutter;
  });

// Java and the Android SDK, for the Android app.
function javaVersion(java) {
  if (!java || !fs.existsSync(java)) return 0;
  const text = output(java, ['-version']) ?? '';
  const [, first, second] = /version "(\d+)(?:\.(\d+))?/.exec(text) ?? [];
  return Number(first === '1' ? second : first) || 0;
}

function javaHomes() {
  const homes = [process.env.JAVA_HOME];
  if (HOST === 'darwin') {
    homes.push('/Applications/Android Studio.app/Contents/jbr/Contents/Home');
    const home = output('/usr/libexec/java_home', ['-v', '17+']);
    if (home) homes.push(home.trim().split('\n').pop());
  } else if (WINDOWS) {
    const programs = process.env.ProgramFiles ?? 'C:\\Program Files';
    homes.push(path.join(programs, 'Android', 'Android Studio', 'jbr'));
    for (const vendor of ['Eclipse Adoptium', 'Microsoft', 'Java', 'Zulu'])
      homes.push(...subdirs(path.join(programs, vendor)));
  } else {
    homes.push(
      '/opt/android-studio/jbr',
      path.join(os.homedir(), 'android-studio', 'jbr'),
      '/snap/android-studio/current/jbr',
    );
    homes.push(...subdirs('/usr/lib/jvm'));
  }
  return homes.filter(Boolean);
}

/** A JDK 17 or newer: { home, version }, home null when it is only on PATH. */
function findJava() {
  for (const home of javaHomes()) {
    const version = javaVersion(path.join(home, 'bin', `java${EXE}`));
    if (version >= 17 && fs.existsSync(path.join(home, 'bin', `keytool${EXE}`))) return { home, version };
  }
  const version = javaVersion(which('java'));
  return version >= 17 ? { home: null, version } : null;
}

async function installJava() {
  say('The Android build needs Java (a JDK) 17 or newer.');
  if (WINDOWS) return winget('Java 21 (Eclipse Temurin)', 'EclipseAdoptium.Temurin.21.JDK');
  if (HOST === 'darwin') return brew('Java 21 (Eclipse Temurin)', ['--cask', 'temurin@21']);
  const available = (pkg) => spawnSync('apt-cache', ['show', pkg], { stdio: 'ignore' }).status === 0;
  return installLinuxPackages('Java', (family) => {
    if (family === 'apt-get')
      return [available('openjdk-21-jdk-headless') ? 'openjdk-21-jdk-headless' : 'openjdk-17-jdk-headless'];
    return { dnf: ['java-21-openjdk-devel'], zypper: ['java-21-openjdk-devel'], pacman: ['jdk21-openjdk'] }[
      family
    ];
  });
}

const ownAndroidSdk = path.join(TOOLS, 'android-sdk');

function findAndroidSdk() {
  const settings = [
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'flutter', 'settings'),
    path.join(WINDOWS ? (process.env.APPDATA ?? '') : os.homedir(), '.flutter_settings'),
  ].map((file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))['android-sdk'];
    } catch {
      return null;
    }
  });
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    ...settings,
    HOST === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Android', 'sdk')
      : WINDOWS
        ? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
        : path.join(os.homedir(), 'Android', 'Sdk'),
    ownAndroidSdk,
  ];
  return (
    candidates.find(
      (dir) =>
        dir &&
        (fs.existsSync(path.join(dir, 'platform-tools')) || fs.existsSync(path.join(dir, 'cmdline-tools'))),
    ) ?? null
  );
}

function sdkManager(sdk) {
  const name = WINDOWS ? 'sdkmanager.bat' : 'sdkmanager';
  const tools = path.join(sdk, 'cmdline-tools');
  return [
    path.join(tools, 'latest', 'bin', name),
    ...subdirs(tools).map((d) => path.join(d, 'bin', name)),
  ].find((f) => fs.existsSync(f));
}

const LICENCE_NOTE =
  'Building Android apps needs the Android SDK licences accepted ' +
  '(https://developer.android.com/studio/terms). Accept them?';

async function installAndroidSdk(env) {
  if (
    !(await confirm(
      `Download the Android SDK command-line tools into ${tilde(ownAndroidSdk)}? (the build then adds the rest, about 3 GB)`,
    ))
  ) {
    return null;
  }
  const platform = { linux: 'linux', darwin: 'mac', win32: 'win' }[HOST];
  const archive = path.join(os.tmpdir(), `ovl-android-tools-${process.pid}.zip`);
  const tools = path.join(ownAndroidSdk, 'cmdline-tools');
  const url = `https://dl.google.com/android/repository/commandlinetools-${platform}-${ANDROID_TOOLS}_latest.zip`;
  must(download(url, archive), 'The Android SDK tools could not be downloaded.');
  fs.rmSync(path.join(tools, 'cmdline-tools'), { recursive: true, force: true });
  fs.mkdirSync(tools, { recursive: true });
  must(unzip(archive, tools), 'The Android SDK tools could not be unpacked.');
  fs.rmSync(archive, { force: true });
  fs.rmSync(path.join(tools, 'latest'), { recursive: true, force: true });
  fs.renameSync(path.join(tools, 'cmdline-tools'), path.join(tools, 'latest'));
  if (!WINDOWS) {
    const bin = path.join(tools, 'latest', 'bin');
    for (const file of fs.readdirSync(bin)) fs.chmodSync(path.join(bin, file), 0o755);
  }
  const manager = sdkManager(ownAndroidSdk);
  const sdkEnv = { ...env, ANDROID_HOME: ownAndroidSdk };
  if (!(await confirm(LICENCE_NOTE))) throw new Error('The Android SDK licences were not accepted.');
  must(
    run(manager, [`--sdk_root=${ownAndroidSdk}`, '--licenses'], { env: sdkEnv, input: 'y\n'.repeat(50) }),
    'The licences could not be accepted.',
  );
  // The platform, build tools and NDK the app needs are downloaded by its Gradle build.
  must(
    run(manager, [`--sdk_root=${ownAndroidSdk}`, 'platform-tools'], { env: sdkEnv }),
    'The Android SDK could not be installed.',
  );
  return ownAndroidSdk;
}

const KEY_PROPERTIES = path.join(APP, 'android', 'key.properties');
const ownKeys = path.join(TOOLS, 'android');

/** Your release key (android/key.properties) when there is one or you agree to create one. */
async function androidSigning(java) {
  const saved = path.join(ownKeys, 'key.properties');
  if (fs.existsSync(KEY_PROPERTIES)) {
    say(`Signing with your release key (${path.relative(ROOT, KEY_PROPERTIES)}).`);
    return true;
  }
  if (fs.existsSync(saved)) {
    fs.copyFileSync(saved, KEY_PROPERTIES);
    say(`Signing with your release key from ${tilde(ownKeys)}.`);
    return true;
  }
  const create = await confirm(
    'Create your own release key for the Android app? Google Play, and updating an installed app, need the ' +
      'same key every time. (No: sign with a test key, fine for trying the app out.)',
  );
  if (!create) return false;
  const keytool = java.home ? path.join(java.home, 'bin', `keytool${EXE}`) : which('keytool');
  if (!keytool) {
    warn('keytool (part of the JDK) was not found; signing with a test key.');
    return false;
  }
  fs.mkdirSync(ownKeys, { recursive: true, mode: 0o700 });
  const store = path.join(ownKeys, 'ovl-business-release.jks');
  const password = randomBytes(18).toString('base64url');
  fs.rmSync(store, { force: true });
  const created = run(
    keytool,
    [
      '-genkeypair',
      '-noprompt',
      '-keystore',
      store,
      '-storetype',
      'PKCS12',
      '-alias',
      'ovl-business',
      '-keyalg',
      'RSA',
      '-keysize',
      '4096',
      '-validity',
      '10000',
      '-dname',
      'CN=OVL For Business',
      '-storepass',
      password,
      '-keypass',
      password,
    ],
    { secret: password },
  );
  if (!created) {
    warn('The key could not be created; signing with a test key.');
    return false;
  }
  // .properties files treat \ as an escape, and Java takes / on Windows too.
  const properties = [
    `storeFile=${store.replace(/\\/g, '/')}`,
    `storePassword=${password}`,
    'keyAlias=ovl-business',
    `keyPassword=${password}`,
    '',
  ].join('\n');
  fs.chmodSync(store, 0o600);
  fs.writeFileSync(saved, properties, { mode: 0o600 });
  fs.copyFileSync(saved, KEY_PROPERTIES);
  say(green(`Created your release key in ${tilde(ownKeys)}.`));
  warn(`Back up ${tilde(ownKeys)}: without this key there is no way to publish updates of the app.`);
  return true;
}

const ensureAndroid = () =>
  once('android', async () => {
    let java = findJava();
    if (!java) {
      await installJava();
      java = findJava();
      if (!java) throw new Error('Java 17 or newer is needed for the Android app.');
    }
    const env = java.home ? { JAVA_HOME: java.home } : {};
    say(`Java ${java.version}${java.home ? dim(` (${tilde(java.home)})`) : ''}`);
    let sdk = findAndroidSdk();
    if (!sdk) {
      say('The Android SDK is not installed (Android Studio installs it; so can this script).');
      sdk = await installAndroidSdk(env);
      if (!sdk)
        throw new Error(
          'The Android SDK is needed: install Android Studio, or run this again and let it download the SDK.',
        );
    }
    say(`Android SDK ${dim(`(${tilde(sdk)})`)}`);
    Object.assign(env, { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk });
    const manager = sdkManager(sdk);
    if (manager && !fs.existsSync(path.join(sdk, 'licenses', 'android-sdk-license'))) {
      if (!(await confirm(LICENCE_NOTE))) throw new Error('The Android SDK licences were not accepted.');
      must(
        run(manager, [`--sdk_root=${sdk}`, '--licenses'], { env, input: 'y\n'.repeat(50) }),
        'The licences could not be accepted.',
      );
    }
    const signed = await androidSigning(java);
    return { env, signed };
  });

// Linux: the compilers and libraries of the desktop app.
function missingLinuxTools() {
  const missing = ['clang', 'cmake', 'ninja', 'pkg-config'].filter((tool) => !which(tool));
  if (which('pkg-config')) {
    for (const lib of ['gtk+-3.0', 'libsecret-1', 'liblzma']) {
      if (spawnSync('pkg-config', ['--exists', lib]).status !== 0) missing.push(lib);
    }
  }
  return missing;
}

const LINUX_PACKAGES = {
  'apt-get': [
    'clang',
    'cmake',
    'ninja-build',
    'pkg-config',
    'g++',
    'libgtk-3-dev',
    'liblzma-dev',
    'libsecret-1-dev',
    'xz-utils',
    'unzip',
  ],
  dnf: [
    'clang',
    'cmake',
    'ninja-build',
    'pkgconf-pkg-config',
    'gcc-c++',
    'gtk3-devel',
    'xz-devel',
    'libsecret-devel',
    'unzip',
  ],
  zypper: [
    'clang',
    'cmake',
    'ninja',
    'pkg-config',
    'gcc-c++',
    'gtk3-devel',
    'xz-devel',
    'libsecret-devel',
    'unzip',
  ],
  pacman: ['clang', 'cmake', 'ninja', 'pkgconf', 'gcc', 'gtk3', 'xz', 'libsecret', 'unzip'],
};

const ensureLinuxTools = () =>
  once('linux', async () => {
    const missing = missingLinuxTools();
    if (!missing.length) return;
    say(`The Linux app needs build tools that are missing: ${missing.join(', ')}.`);
    await installLinuxPackages('the build tools', LINUX_PACKAGES);
    const still = missingLinuxTools();
    if (still.length) throw new Error(`Still missing: ${still.join(', ')}.`);
  });

// macOS: Xcode (both Apple apps), CocoaPods.
function xcodeVersion() {
  return /Xcode (\d+[\d.]*)/.exec(output('xcodebuild', ['-version']) ?? '')?.[1] ?? null;
}

const ensureXcode = () =>
  once('xcode', async () => {
    let version = xcodeVersion();
    if (!version && fs.existsSync('/Applications/Xcode.app')) {
      say('Xcode is installed but not selected for command-line builds.');
      if (
        await confirm(
          'Select it now? (asks for your password)\n  sudo xcode-select --switch /Applications/Xcode.app && sudo xcodebuild -runFirstLaunch\n',
        )
      ) {
        run('sudo', ['xcode-select', '--switch', '/Applications/Xcode.app/Contents/Developer']);
        run('sudo', ['xcodebuild', '-runFirstLaunch']);
        version = xcodeVersion();
      }
    }
    if (!version)
      throw new Error('Xcode is needed: install it from the App Store, open it once, then run this again.');
    say(`Xcode ${version}`);
    if (!which('pod')) {
      say('CocoaPods (used by the Apple builds of Flutter plugins) is not installed.');
      await brew('CocoaPods', ['cocoapods']);
    }
  });

// Windows: the Visual Studio C++ tools, and Developer Mode (Flutter links the app's plugins).
function visualStudio() {
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  );
  if (!fs.existsSync(vswhere)) return null;
  const found = output(vswhere, [
    '-latest',
    '-products',
    '*',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property',
    'installationPath',
  ]);
  return found?.trim() || null;
}

function canSymlink() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-link-'));
  try {
    fs.writeFileSync(path.join(dir, 'a'), '');
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'b'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ensureSymlinks = () =>
  once('symlinks', async () => {
    if (!WINDOWS || canSymlink()) return;
    say('Flutter needs Windows Developer Mode to build apps with plugins.');
    if (interactive) {
      spawnSync('cmd', ['/c', 'start', 'ms-settings:developers'], { stdio: 'ignore' });
      await prompt('Settings is open at "For developers": turn on Developer Mode, then press Enter here. ');
    }
    if (!canSymlink())
      throw new Error('Turn on Developer Mode (Settings → For developers), then run this again.');
  });

const ensureVisualStudio = () =>
  once('vs', async () => {
    if (!visualStudio()) {
      say('The Windows app needs the Visual Studio C++ build tools, which are not installed.');
      await winget('the Visual Studio 2022 Build Tools with C++', 'Microsoft.VisualStudio.2022.BuildTools', [
        '--override',
        '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended',
      ]);
    }
    const found = visualStudio();
    if (!found)
      throw new Error('Install Visual Studio with "Desktop development with C++", then run this again.');
    say(`Visual Studio ${dim(`(${found})`)}`);
  });

// ---------------------------------------------------------------------------------------------------
// Targets

const flutterArgs = (ctx) => [
  '--release',
  `--dart-define=OVL_API_URL=${ctx.apiUrl}`,
  ...(ctx.buildNumber ? ['--build-number', ctx.buildNumber] : []),
];

async function buildStatic(ctx, pkg, dir, id) {
  const pnpm = await once('pnpm', async () => {
    const found = findPnpm();
    if (!found)
      throw new Error('pnpm could not be found or started (it comes with Node.js through corepack).');
    return found;
  });
  const [bin, ...pre] = pnpm;
  await once('pnpm-install', async () => {
    const filters = ctx.targets
      .filter((t) => t === 'web' || t === 'admin')
      .flatMap((t) => ['--filter', `${TARGETS[t].pkg}...`]);
    must(
      run(bin, [...pre, 'install', '--frozen-lockfile', ...filters], { env: pnpmEnv }),
      'Installing the JavaScript packages failed.',
    );
  });
  must(
    run(bin, [...pre, '--filter', pkg, 'build'], { env: pnpmEnv }),
    `The ${id} build failed; the messages above say why.`,
  );
  const dist = path.join(ROOT, dir, 'dist');
  fs.writeFileSync(
    path.join(dist, 'config.js'),
    `// Written by build-clients: the address of the OVL For Business server.\nwindow.__OVL_CONFIG__ = { apiUrl: ${JSON.stringify(ctx.apiUrl)} };\n`,
  );
  const file = path.join(ctx.out, `${ctx.name}-${id}.zip`);
  writeZip(dist, file);
  return [file];
}

const TARGETS = {
  web: {
    label: 'Web client',
    detail: 'static files for any web host',
    pkg: '@ovl/web',
    prepare: async () => {},
    build: (ctx) => buildStatic(ctx, '@ovl/web', 'clients/web', 'web'),
    next: 'Put the files of the .zip on any web host. Send unknown paths to index.html, and don’t cache config.js, sw.js or index.html.',
  },
  admin: {
    label: 'Admin panel',
    detail: 'static files for any web host',
    pkg: '@ovl/admin',
    prepare: async () => {},
    build: (ctx) => buildStatic(ctx, '@ovl/admin', 'admin', 'admin'),
    next: 'Host it like the web client, preferably on its own address that only staff can reach.',
  },
  android: {
    label: 'Android app',
    detail: 'APK, and a bundle for Google Play',
    prepare: async (ctx) => {
      await ensureFlutter();
      await ensureSymlinks();
      await ensureAndroid();
    },
    build: async (ctx) => {
      const flutter = await ensureFlutter();
      const { env, signed } = await ensureAndroid();
      must(
        run(flutter, ['build', 'apk', ...flutterArgs(ctx)], { cwd: APP, env }),
        'The Android build failed; the messages above say why.',
      );
      const apk = path.join(ctx.out, `${ctx.name}-android.apk`);
      fs.copyFileSync(path.join(APP, 'build', 'app', 'outputs', 'flutter-apk', 'app-release.apk'), apk);
      if (!signed) return [apk];
      must(
        run(flutter, ['build', 'appbundle', ...flutterArgs(ctx)], { cwd: APP, env }),
        'The Android app bundle build failed.',
      );
      const aab = path.join(ctx.out, `${ctx.name}-android.aab`);
      fs.copyFileSync(path.join(APP, 'build', 'app', 'outputs', 'bundle', 'release', 'app-release.aab'), aab);
      return [apk, aab];
    },
    next: 'Copy the .apk to a phone and open it to install (allow installing from that source). Upload the .aab to Google Play.',
  },
  ios: {
    label: 'iPhone and iPad app',
    hosts: ['darwin'],
    prepare: async (ctx) => {
      await ensureFlutter();
      await ensureXcode();
      ctx.iosSigned = await confirm(
        'Sign the iPhone app for the App Store / TestFlight? This needs your Apple developer team set in Xcode ' +
          '(open clients/app/ios/Runner.xcworkspace → Runner → Signing). No: an unsigned .ipa, to sign later.',
        false,
      );
    },
    build: async (ctx) => {
      const flutter = await ensureFlutter();
      if (ctx.iosSigned) {
        must(
          run(flutter, ['build', 'ipa', ...flutterArgs(ctx)], { cwd: APP }),
          'The iOS build failed; the messages above say why.',
        );
        const dir = path.join(APP, 'build', 'ios', 'ipa');
        const ipa = fs.readdirSync(dir).find((f) => f.endsWith('.ipa'));
        must(ipa, 'The build made no .ipa.');
        const file = path.join(ctx.out, `${ctx.name}-ios.ipa`);
        fs.copyFileSync(path.join(dir, ipa), file);
        return [file];
      }
      must(
        run(flutter, ['build', 'ios', '--no-codesign', ...flutterArgs(ctx)], { cwd: APP }),
        'The iOS build failed; the messages above say why.',
      );
      const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-ipa-'));
      const payload = path.join(staging, 'Payload');
      fs.mkdirSync(payload);
      must(
        run('ditto', [
          path.join(APP, 'build', 'ios', 'iphoneos', 'Runner.app'),
          path.join(payload, 'Runner.app'),
        ]),
        'Copying the app failed.',
      );
      const file = path.join(ctx.out, `${ctx.name}-ios-unsigned.ipa`);
      fs.rmSync(file, { force: true });
      must(
        run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', payload, file]),
        'Packing the .ipa failed.',
      );
      fs.rmSync(staging, { recursive: true, force: true });
      return [file];
    },
    next: 'Upload a signed .ipa with Transporter or Xcode; an unsigned one has to be signed with your Apple developer account first.',
  },
  macos: {
    label: 'Mac app',
    hosts: ['darwin'],
    prepare: async () => {
      await ensureFlutter();
      await ensureXcode();
    },
    build: async (ctx) => {
      const flutter = await ensureFlutter();
      must(
        run(flutter, ['build', 'macos', ...flutterArgs(ctx)], { cwd: APP }),
        'The macOS build failed; the messages above say why.',
      );
      const dir = path.join(APP, 'build', 'macos', 'Build', 'Products', 'Release');
      const app = fs.readdirSync(dir).find((f) => f.endsWith('.app'));
      must(app, 'The build made no .app.');
      const zip = path.join(ctx.out, `${ctx.name}-macos.zip`);
      const dmg = path.join(ctx.out, `${ctx.name}-macos.dmg`);
      fs.rmSync(zip, { force: true });
      must(
        run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(dir, app), zip]),
        'Packing the app failed.',
      );
      const volume = app.replace(/\.app$/, '');
      const made = run('hdiutil', [
        'create',
        '-volname',
        volume,
        '-srcfolder',
        path.join(dir, app),
        '-ov',
        '-format',
        'UDZO',
        dmg,
      ]);
      return made ? [dmg, zip] : [zip];
    },
    next: 'Open the .dmg and drag the app to Applications. For other Macs, sign and notarize it with your Developer ID.',
  },
  windows: {
    label: 'Windows app',
    hosts: ['win32'],
    prepare: async () => {
      await ensureFlutter();
      await ensureSymlinks();
      await ensureVisualStudio();
    },
    build: async (ctx) => {
      const flutter = await ensureFlutter();
      must(
        run(flutter, ['build', 'windows', ...flutterArgs(ctx)], { cwd: APP }),
        'The Windows build failed; the messages above say why.',
      );
      const release = path.join(APP, 'build', 'windows', ARCH, 'runner', 'Release');
      const name = `${ctx.name}-windows-${ARCH}`;
      const file = path.join(ctx.out, `${name}.zip`);
      writeZip(release, file, name);
      return [file];
    },
    next: 'Unzip it anywhere and start ovl_business.exe.',
  },
  linux: {
    label: 'Linux app',
    hosts: ['linux'],
    prepare: async () => {
      await ensureFlutter();
      await ensureLinuxTools();
    },
    build: async (ctx) => {
      const flutter = await ensureFlutter();
      must(
        run(flutter, ['build', 'linux', ...flutterArgs(ctx)], { cwd: APP }),
        'The Linux build failed; the messages above say why.',
      );
      const bundle = path.join(APP, 'build', 'linux', ARCH, 'release', 'bundle');
      const name = `${ctx.name}-linux-${ARCH}`;
      const file = path.join(ctx.out, `${name}.tar.gz`);
      writeTarGz(bundle, file, name);
      return [file];
    },
    next: 'Unpack it anywhere and start ./ovl_business (it needs GTK 3 and libsecret, present on most desktops).',
  },
};

const ONLY_ON = { darwin: 'on a Mac only', win32: 'on Windows only', linux: 'on Linux only' };

/** Why this computer can't build a target, or null when it can. */
const unavailable = (id) => {
  const { hosts } = TARGETS[id];
  return hosts && !hosts.includes(HOST) ? ONLY_ON[hosts[0]] : null;
};

/** What a target still needs here, cheaply (without starting anything). */
function status(id) {
  const why = unavailable(id);
  if (why) return dim(why);
  const needs = [];
  if (id !== 'web' && id !== 'admin' && !findFlutter()) needs.push('Flutter');
  if (id === 'android') {
    if (!findJava()) needs.push('Java');
    if (!findAndroidSdk()) needs.push('the Android SDK');
  }
  if (id === 'linux') needs.push(...missingLinuxTools());
  if ((id === 'ios' || id === 'macos') && !xcodeVersion()) needs.push('Xcode');
  if (id === 'windows' && !visualStudio()) needs.push('Visual Studio C++ tools');
  return needs.length ? yellow(`needs ${needs.join(', ')} (offered)`) : green('ready');
}

function printTargets() {
  say(`What this computer (${HOST_NAME}, ${ARCH}) can build:`);
  Object.keys(TARGETS).forEach((id, i) => {
    const { label, detail } = TARGETS[id];
    say(`  ${i + 1}) ${id.padEnd(8)} ${`${label}${detail ? ` — ${detail}` : ''}`.padEnd(64)} ${status(id)}`);
  });
}

// ---------------------------------------------------------------------------------------------------
// Main

function parseArgs(argv) {
  const opts = { targets: [], yes: false, list: false, help: false, apiUrl: '', out: '', buildNumber: '' };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let value;
    if (/^--[\w-]+=/.test(arg))
      [arg, value] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
    const next = () => {
      const v = value ?? argv[++i];
      if (v === undefined || v === '') throw new Error(`${arg} needs a value.`);
      return v;
    };
    if (arg === '--api-url') opts.apiUrl = next();
    else if (arg === '--out') opts.out = next();
    else if (arg === '--build-number') opts.buildNumber = next();
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--list') opts.list = true;
    else if (arg === '--help' || arg === '-h' || arg === '/?') opts.help = true;
    else if (arg === 'all' || TARGETS[arg]) opts.targets.push(arg);
    else throw new Error(`Unknown option or target: ${arg} (see --help).`);
  }
  if (opts.buildNumber && !/^\d+$/.test(opts.buildNumber))
    throw new Error('--build-number takes a whole number.');
  return opts;
}

/** The server address from the .env that setup.sh wrote next to this checkout. */
function serverFromEnv() {
  const env = read('.env') ?? '';
  const value = /^PUBLIC_WEB_URL=(.*)$/m
    .exec(env)?.[1]
    ?.trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  return value && !value.includes('example.com') ? value : '';
}

function normalizeUrl(input) {
  const text = input.trim().replace(/\/+$/, '');
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash)
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function askServer(opts) {
  const fallback = opts.apiUrl || process.env.OVL_API_URL || serverFromEnv();
  for (;;) {
    const answer = await ask(
      'Address of your server, the one people open in a browser (e.g. https://business.example.com)',
      fallback,
    );
    const url = normalizeUrl(answer);
    if (url) {
      const { protocol, hostname } = new URL(url);
      const local = /^(localhost|[\d.]+|\[[\da-f:]+\]|.+\.local)$/i.test(hostname);
      if (protocol === 'http:' && !local) {
        warn(
          'iPhone and Mac apps only connect to http:// addresses on the local network; use https:// for a domain.',
        );
      }
      return url;
    }
    if (!interactive)
      throw new Error(
        answer ? `Not a server address: ${answer}` : 'Pass the server address: --api-url https://…',
      );
    say(
      answer
        ? `"${answer}" is not a server address; type it like https://business.example.com`
        : 'The apps need the address.',
    );
  }
}

async function pickTargets(opts) {
  const ids = Object.keys(TARGETS);
  const buildable = ids.filter((id) => !unavailable(id));
  if (opts.targets.length) {
    const wanted = opts.targets.includes('all') ? buildable : [...new Set(opts.targets)];
    for (const id of wanted.filter(unavailable)) warn(`${TARGETS[id].label}: ${unavailable(id)}, skipped.`);
    return wanted.filter((id) => !unavailable(id));
  }
  if (!interactive) return buildable;
  say();
  printTargets();
  for (;;) {
    const answer = await ask(
      'What should be built? Numbers or names separated by spaces',
      buildable.map((id) => ids.indexOf(id) + 1).join(' '),
    );
    const picked = answer
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((word) =>
        /^\d+$/.test(word) ? (ids[Number(word) - 1] ?? word) : word === 'all' ? buildable : word,
      )
      .flat();
    const wrong = picked.filter((id) => !TARGETS[id]);
    const elsewhere = picked.filter((id) => TARGETS[id] && unavailable(id));
    if (!wrong.length && !elsewhere.length && picked.length) return [...new Set(picked)];
    if (wrong.length) say(`Not a choice: ${wrong.join(' ')}`);
    for (const id of elsewhere) say(`${TARGETS[id].label} can be built ${unavailable(id)}.`);
  }
}

function writeChecksums(out) {
  const files = fs
    .readdirSync(out)
    .filter((f) => f !== 'SHA256SUMS.txt' && fs.statSync(path.join(out, f)).isFile())
    .sort();
  const lines = files.map(
    (f) =>
      `${createHash('sha256')
        .update(fs.readFileSync(path.join(out, f)))
        .digest('hex')}  ${f}`,
  );
  fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
}

const size = (file) => {
  const bytes = fs.statSync(file).size;
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    say(USAGE);
    return 0;
  }
  if (opts.list) {
    printTargets();
    return 0;
  }
  interactive = !opts.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const version = /^version:\s*([^+\s]+)/m.exec(read('clients/app/pubspec.yaml') ?? '')?.[1] ?? '0.0.0';
  say(`${bold('OVL For Business — app builder')} ${dim(`version ${version}, on ${HOST_NAME} ${ARCH}`)}`);
  say(dim('It asks everything first (and installs what is missing if you agree), then builds.'));
  say();

  const apiUrl = await askServer(opts);
  const targets = await pickTargets(opts);
  if (!targets.length) {
    say('Nothing to build.');
    return 0;
  }
  const out = path.resolve(opts.out || path.join(ROOT, 'dist', 'clients'));
  const ctx = { apiUrl, targets, out, name: `ovl-business-${version}`, buildNumber: opts.buildNumber };

  const failed = new Map();
  heading('Checking the tools');
  for (const id of targets) {
    try {
      await TARGETS[id].prepare(ctx);
    } catch (error) {
      failed.set(id, error.message);
      console.log(red(`✗ ${TARGETS[id].label}: ${error.message}`));
    }
  }

  fs.mkdirSync(out, { recursive: true });
  const built = new Map();
  for (const id of targets.filter((t) => !failed.has(t))) {
    heading(`${TARGETS[id].label} for ${apiUrl}`);
    try {
      built.set(id, await TARGETS[id].build(ctx));
    } catch (error) {
      failed.set(id, error.message);
      console.log(red(`✗ ${error.message}`));
    }
  }
  if (built.size) writeChecksums(out);

  heading('Done');
  for (const [id, files] of built) {
    say(`${green('✓')} ${TARGETS[id].label}`);
    for (const file of files) say(`    ${shown(file)}  ${dim(size(file))}`);
    say(dim(`    ${TARGETS[id].next}`));
  }
  for (const [id, message] of failed) say(`${red('✗')} ${TARGETS[id].label}: ${message}`);
  if (built.size) say(`\nChecksums: ${shown(path.join(out, 'SHA256SUMS.txt'))}`);
  const elsewhere = Object.keys(TARGETS).filter(unavailable);
  if (elsewhere.length) {
    say(dim(`\n${elsewhere.map((id) => TARGETS[id].label).join(', ')}: run this on that system, or use the`));
    say(dim('"Native apps" GitHub workflow, which builds every native app (set the OVL_API_URL variable).'));
  }
  return failed.size ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(red(error.message));
    process.exit(1);
  },
);
