# How to add a license key

Everything about license keys now lives in **`license-keys.json`** in this repo.
You edit that one file, press **Commit changes**, and it is done - no rebuild, no new APK,
no Firebase Studio needed. Every app that is already installed on a phone picks the new list up
by itself the next time it is opened.

---

## Part 1 - do this ONCE (5 files)

Upload these files to the repo (GitHub -> **Code** tab -> **Add file** -> **Upload files** ->
choose the files -> scroll down -> **Commit changes**):

| File | What it does |
| --- | --- |
| `index.html` | the app - now reads the key list from `license-keys.json` |
| `license-keys.json` | **the key list** (new file). This is the only file you touch later |
| `firebase.json` | lets the app download the list from optimizerv4.web.app |
| `key-maker.html` | the little page that turns a key into the hash line (new file) |
| `ADD-LICENSE-KEY.md` | this page (new file) |

Optional: also re-upload **`src/main.js`** (this one goes in the `src` folder) - it only adds a
"Live key list" row to the About tab so you can see that the app is reading the new list.

**Very important:** when you download a file and the browser names it `index (1).html`, rename it
back to exactly `index.html` before uploading, otherwise GitHub creates a second file instead of
replacing the old one.

After the commit:

* the website version updates by itself (deploy workflow) - a minute or two;
* the APK workflow starts by itself. Open the **Actions** tab, wait for the green tick, then
  download the new APK artifact (`OptimizerV4-debug-apk`) and share **that** APK with customers.

That rebuild is a **one time** thing. From now on you never rebuild again to add a key.

---

## Part 2 - how to add a key (this is the normal flow, takes 1 minute)

**Step 1 - make the key.** Open the key maker page:

    https://optimizerv4.web.app/key-maker.html

1. Type a customer name (for example `customer-2`).
2. Press **Make a random key for me** - or type your own key (12+ letters/numbers).
3. Pick an expiry date, or leave it empty so the key never expires.
4. Press **Make the key line**.
5. Copy **the key** (send this to the customer) and copy **the line** (goes in the JSON file).

**Step 2 - add the line.** In the repo open **`license-keys.json`** -> pencil button ->
put the copied line inside the square brackets of `"keys"`, just above the closing `]`:

```json
  "keys": [
    { "label": "owner", "hash": "7542465f...810df", "exp": null },
    { "label": "customer-1", "hash": "bcffd596...82013", "exp": null },
    { "label": "customer-2", "hash": "the line you copied", "exp": null }
  ],
```

**Step 3 - commit.** Press **Commit changes**. Done - the key works in the website immediately
and in every installed app within a minute.

The customer then opens the app and types the key into **Enter the license key** on the lock
screen (they can tick **Remember key** so they never type it again).

---

## Part 3 - expire or block a key

Open `license-keys.json` again:

* **Stop a key after a date:** change that line's `"exp": null` to
  `"exp": "2026-12-31T23:59:59.000Z"` (any date).
* **Block a key right now:** cut its `hash` and paste it inside the `"revoked": [ ]` list:

```json
  "revoked": [
    "bcffd5963e041f285e8cb2e930531257b70f122576395b5d1ae508905c682013"
  ]
```

  or simply delete the whole `{ "label": ... }` line.
* Commit. The app locks that key the next time it is started with internet.

---

## Good to know

* **A key must have at least 12 letters/numbers.** Longer is stronger - the key maker makes 20.
* Capital letters and dashes do not matter: `OPT-1A2B-3C4D` and `opt1a2b3c4d` are the same key.
  Tell customers they can type it with or without the `-`.
* The plaintext key is never in the app - only its SHA-256 hash. Nobody can read keys out of the
  app, and you can send one key to one customer.
* **Internet for the first activation:** a key that lives only in `license-keys.json` must be
  entered while the phone is online (the app then remembers the list, so it keeps working
  offline afterwards). The two keys baked inside `index.html` (`owner`, `spare-30d`) work with no
  internet at all. If you want a key that always works offline, add it to the `window.LICENSE_KEYS`
  list near the top of `index.html` instead - but that one needs a new APK.
* If a customer's phone has no internet and the key is not in the app's list yet, the lock screen
  says **"The key did not register"**. Ask them to turn on data/wifi and press **Activate** again.
* The app checks the phone's clock; changing the date backwards locks the app as tampering.

---

## For a future developer / AI agent

`index.html` contains `window.LICENSE_KEYS` (keys baked into the build) and
`window.LICENSE_KEYS_URLS` (remote sources). The gate (the third `<script>` in index.html) fetches
all sources in parallel with a 5s cap, merges the winner over the baked-in list (remote entry wins
per hash), applies `"revoked"`, and caches the result in `localStorage["licenseGate.remoteList.v1"]`
so previously downloaded keys keep working offline. `key-maker.html` is a standalone SHA-256 hash
tool; the hash is of the key after `toUpperCase().replace(/[^A-Z0-9]/g, "")`, and
`window.__licenseGate.sync()` reports `{ state, ok, source, count }` for diagnostics.
