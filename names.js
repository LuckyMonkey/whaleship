'use strict';
// Docker-style container names for WHALESHIP.
// The adjective and surname lists are ported verbatim from Moby's name generator
// (github.com/moby/moby, pkg/namesgenerator/names-generator.go @ v27.5.1), Copyright Docker, Inc.,
// licensed under the Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
// Like Docker: names are adjective_surname, and "boring_wozniak" is never generated (Steve Wozniak is not boring).
const crypto = require('node:crypto');
const LEFT = ["admiring", "adoring", "affectionate", "agitated", "amazing", "angry", "awesome", "beautiful", "blissful", "bold", "boring", "brave", "busy", "charming", "clever", "compassionate", "competent", "condescending", "confident", "cool", "cranky", "crazy", "dazzling", "determined", "distracted", "dreamy", "eager", "ecstatic", "elastic", "elated", "elegant", "eloquent", "epic", "exciting", "fervent", "festive", "flamboyant", "focused", "friendly", "frosty", "funny", "gallant", "gifted", "goofy", "gracious", "great", "happy", "hardcore", "heuristic", "hopeful", "hungry", "infallible", "inspiring", "intelligent", "interesting", "jolly", "jovial", "keen", "kind", "laughing", "loving", "lucid", "magical", "modest", "musing", "mystifying", "naughty", "nervous", "nice", "nifty", "nostalgic", "objective", "optimistic", "peaceful", "pedantic", "pensive", "practical", "priceless", "quirky", "quizzical", "recursing", "relaxed", "reverent", "romantic", "sad", "serene", "sharp", "silly", "sleepy", "stoic", "strange", "stupefied", "suspicious", "sweet", "tender", "thirsty", "trusting", "unruffled", "upbeat", "vibrant", "vigilant", "vigorous", "wizardly", "wonderful", "xenodochial", "youthful", "zealous", "zen"];
const RIGHT = ["agnesi", "albattani", "allen", "almeida", "antonelli", "archimedes", "ardinghelli", "aryabhata", "austin", "babbage", "banach", "banzai", "bardeen", "bartik", "bassi", "beaver", "bell", "benz", "bhabha", "bhaskara", "black", "blackburn", "blackwell", "bohr", "booth", "borg", "bose", "bouman", "boyd", "brahmagupta", "brattain", "brown", "buck", "burnell", "cannon", "carson", "cartwright", "carver", "cerf", "chandrasekhar", "chaplygin", "chatelet", "chatterjee", "chaum", "chebyshev", "clarke", "cohen", "colden", "cori", "cray", "curie", "curran", "darwin", "davinci", "dewdney", "dhawan", "diffie", "dijkstra", "dirac", "driscoll", "dubinsky", "easley", "edison", "einstein", "elbakyan", "elgamal", "elion", "ellis", "engelbart", "euclid", "euler", "faraday", "feistel", "fermat", "fermi", "feynman", "franklin", "gagarin", "galileo", "galois", "ganguly", "gates", "gauss", "germain", "goldberg", "goldstine", "goldwasser", "golick", "goodall", "gould", "greider", "grothendieck", "haibt", "hamilton", "haslett", "hawking", "heisenberg", "hellman", "hermann", "herschel", "hertz", "heyrovsky", "hodgkin", "hofstadter", "hoover", "hopper", "hugle", "hypatia", "ishizaka", "jackson", "jang", "jemison", "jennings", "jepsen", "johnson", "joliot", "jones", "kalam", "kapitsa", "kare", "keldysh", "keller", "kepler", "khayyam", "khorana", "kilby", "kirch", "knuth", "kowalevski", "lalande", "lamarr", "lamport", "leakey", "leavitt", "lederberg", "lehmann", "lewin", "lichterman", "liskov", "lovelace", "lumiere", "mahavira", "margulis", "matsumoto", "maxwell", "mayer", "mccarthy", "mcclintock", "mclaren", "mclean", "mcnulty", "meitner", "mendel", "mendeleev", "meninsky", "merkle", "mestorf", "mirzakhani", "montalcini", "moore", "morse", "moser", "murdock", "napier", "nash", "neumann", "newton", "nightingale", "nobel", "noether", "northcutt", "noyce", "panini", "pare", "pascal", "pasteur", "payne", "perlman", "pike", "poincare", "poitras", "proskuriakova", "ptolemy", "raman", "ramanujan", "rhodes", "ride", "ritchie", "robinson", "roentgen", "rosalind", "rubin", "saha", "sammet", "sanderson", "satoshi", "shamir", "shannon", "shaw", "shirley", "shockley", "shtern", "sinoussi", "snyder", "solomon", "spence", "stonebraker", "sutherland", "swanson", "swartz", "swirles", "taussig", "tesla", "tharp", "thompson", "torvalds", "tu", "turing", "varahamihira", "vaughan", "villani", "visvesvaraya", "volhard", "wescoff", "wilbur", "wiles", "williams", "williamson", "wilson", "wing", "wozniak", "wright", "wu", "yalow", "yonath", "zhukovsky"];
// Optional WHALESHIP extension: a few maritime adjectives mixed in now and then.
const MARITIME = ['barnacled', 'buoyant', 'salty', 'soggy', 'sunken', 'whalehearted', 'briny', 'seasick'];
// A small deterministic PRNG seeded from the match id, so a match always gets the same names (also on reconnect).
function rng(seed) { let h = crypto.createHash('sha256').update(String(seed)).digest(), i = 0;
  return () => { if (i + 4 > h.length) { h = crypto.createHash('sha256').update(h).digest(); i = 0; } const v = h.readUInt32BE(i); i += 4; return v / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
function dockerName(r, used) {
  for (let retry = 0; ; retry++) {
    const left = r() < .12 ? pick(r, MARITIME) : pick(r, LEFT), right = pick(r, RIGHT);
    let name = `${left}_${right}`; if (name === 'boring_wozniak') continue;
    if (retry > 0) name += Math.floor(r() * 10);           // Docker appends a digit when it retries
    if (!used.has(name)) { used.add(name); return name; }
  }
}
const alnum = (r, n, set = 'bcdfghjklmnpqrstvwxz2456789') => Array.from({length: n}, () => set[Math.floor(r() * set.length)]).join('');
const IMAGES = [
  ['nginx:alpine', 'redis:7-alpine', 'postgres:17', 'alpine:3.20', 'busybox:1.36', 'node:22-alpine', 'caddy:2', 'docker:dind'],   // moby: docker host
  ['nginx:alpine', 'whaleship/api:2.4', 'traefik:v3'],                                                                       // k8s carrier: deployment pods
  ['postgres:17', 'minio/minio', 'etcd:3.5'],                                                                                  // walrus: storage
  ['node:22-alpine', 'python:3.13-slim', 'golang:1.23'],                                                                      // tux: linux workloads
  ['haproxy:3.0', 'envoyproxy/envoy:v1.31', 'caddy:2'],                                                                       // squid: proxies
];
// One entry per ship segment. Docker hosts (whales, Tux's iceberg, the squid proxy) get container names; the Kubernetes
// carrier runs Deployment pods; storage gets StatefulSet ordinals — so the game quietly teaches the conventions.
function manifest(matchId, seat, fleet, used = new Set()) {
  const r = rng(`${matchId}:${seat}`), out = {};
  for (const f of fleet) {
    const imgs = IMAGES[f.kind % 5], rs = alnum(r, 10), svc = f.name.replace(/-\d+\w?$/, '');
    out[f.id] = Array.from({length: f.len}, (_, j) => {
      const image = imgs[(j + Math.floor(r() * imgs.length)) % imgs.length]; let name;
      if (f.kind === 1) name = `${svc}-api-${rs}-${alnum(r, 5)}`;                                                // Deployment pod on the Kubernetes carrier
      else if (f.kind === 2) name = `${f.name}-${image.split(/[:/]/)[0] === 'minio' ? 'minio' : image.split(/[:/]/)[0]}-${j}`;   // StatefulSet pod
      else name = dockerName(r, used);                                                                            // plain docker container
      used.add(name); return { name, image, kind: f.kind === 1 ? 'deployment-pod' : f.kind === 2 ? 'statefulset-pod' : 'container' };
    });
  }
  return out;
}
module.exports = { manifest, dockerName, rng, LEFT, RIGHT, MARITIME };
