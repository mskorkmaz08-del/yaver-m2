#!/usr/bin/env python3
"""
Mini Yaver bridge: connects the Arduino Uno (USB) to the AI.

Run it on the Mac with:   python3 mini_yaver_bridge.py
Nothing to install: it only uses what comes with Python.

- The Uno sends button / remote / RFID / sensor events over USB.
- This script asks the AI (Google Gemini, free key) and sends the answer
  back in small pieces, waiting for the Uno's "K" after each one
  (the Uno can only hold 64 incoming bytes at a time).
- You can also type questions here. Commands: /lamp on|off, /pan 90,
  /nod, /log, /clearcards, /help, /quit
"""
import glob, json, os, queue, re, ssl, sys, termios, threading, time, unicodedata
import urllib.request, urllib.error
from getpass import getpass

MODEL = os.environ.get("MINI_YAVER_MODEL", "gemini-flash-latest")
KEY_FILE = os.path.expanduser("~/.mini_yaver_key")
CHUNK = 40           # characters per "A " line (keeps each line under the Uno's buffer)

# What each remote digit (and each RFID card bound to that digit) asks.
PRESETS = {
    0: "Give me a quick status of my room from the sensor readings, and one tip.",
    1: "Tell me a short clean joke.",
    2: "Teach me one surprising fact about the Arduino Uno or electronics.",
    3: "Motivate me in one or two sentences, like JARVIS would.",
    4: "Pick one part from my Arduino kit and explain what it does in simple words.",
    5: "Suggest one cool thing I could build next with my kit, in 3 short steps.",
    6: "Give me a 3 question mental math quiz. Put the answers at the very end.",
    7: "Summarize how my room changed over the logged period (temperature, humidity, light, noise).",
    8: "Look at the light level and decide if the desk lamp should be on. Use the lamp tag.",
    9: "Say something kind and short to greet me as Yaver.",
}

SYSTEM = (
    "You are Yaver, Mustafa's personal assistant, speaking through a tiny 16x2 LCD on an "
    "Arduino Uno. Answer in plain ASCII text only: no markdown, no emoji, no lists with symbols. "
    "Keep the answer under {cap} characters, the shorter the better. "
    "You can control the desk device by adding tags anywhere in your answer: "
    "[LAMP ON], [LAMP OFF], [PAN <degrees from -180 to 180>], [NOD], [BEEP <1-3>]. "
    "Only use a tag when it makes sense. Live sensor readings: {sensors}. Local time: {time}."
)

# ------------------------------------------------------------------ serial (no pyserial needed)
class Uno:
    def __init__(self, path):
        self.fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        attrs = termios.tcgetattr(self.fd)
        attrs[0] = 0                                    # iflag: raw
        attrs[1] = 0                                    # oflag: raw
        attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
        attrs[3] = 0                                    # lflag: no echo, no line editing
        attrs[4] = attrs[5] = termios.B115200
        attrs[6][termios.VMIN] = 0
        attrs[6][termios.VTIME] = 0
        termios.tcsetattr(self.fd, termios.TCSANOW, attrs)
        termios.tcflush(self.fd, termios.TCIOFLUSH)
        self.ack = threading.Event()
        self.events = queue.Queue()
        self.write_lock = threading.Lock()
        self.cap = 640
        self.sensors = {}
        self.log_lines = None
        self.log_done = threading.Event()
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        buf = b""
        while True:
            try:
                data = os.read(self.fd, 256)
            except BlockingIOError:
                data = b""
            except OSError:
                print("\n[!] USB disconnected. Plug the Uno back in and run me again.")
                os._exit(1)
            if not data:
                time.sleep(0.01)
                continue
            buf += data
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("ascii", "replace").strip()
                if line:
                    self._got(line)

    def _got(self, line):
        if line == "K":
            self.ack.set()
        elif line.startswith("S "):
            self.sensors = dict(p.split("=", 1) for p in line[2:].split() if "=" in p)
        elif line.startswith("HELLO"):
            m = re.search(r"cap=(\d+)", line)
            if m:
                self.cap = int(m.group(1))
            self.events.put(("hello", line))
        elif line.startswith("LOGBEGIN"):
            self.log_lines = []
        elif line.startswith("LOG ") and self.log_lines is not None:
            self.log_lines.append(line)
        elif line == "LOGEND":
            self.log_done.set()
        else:
            self.events.put(("event", line))

    def send(self, line, timeout=2.0):
        """Send one line, then wait for the Uno's K so its 64-byte buffer never overflows."""
        with self.write_lock:
            self.ack.clear()
            os.write(self.fd, (line + "\n").encode("ascii", "replace"))
            if not self.ack.wait(timeout):
                print(f"[!] no reply from the Uno to: {line[:20]}")

    def read_log(self):
        self.log_done.clear()
        self.send("LG")
        self.log_done.wait(5)
        lines, self.log_lines = self.log_lines or [], None
        return lines


def find_port():
    if len(sys.argv) > 1 and sys.argv[1].startswith("/dev/"):
        return sys.argv[1]
    ports = (glob.glob("/dev/cu.wchusbserial*") + glob.glob("/dev/cu.usbserial*")
             + glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*"))
    if not ports:
        print("I can't see the Uno. Check the USB cable (it must be a data cable).")
        print("CH340 boards on a Mac may need the WCH driver: search 'CH34x macOS driver wch.cn'.")
        sys.exit(1)
    return ports[0]

# ------------------------------------------------------------------ AI
def get_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    if os.path.exists(KEY_FILE):
        return open(KEY_FILE).read().strip()
    print("Paste your free Gemini API key (from aistudio.google.com/apikey).")
    print("It is saved only on this Mac, in ~/.mini_yaver_key.")
    key = getpass("Key: ").strip()
    with open(KEY_FILE, "w") as f:
        f.write(key)
    os.chmod(KEY_FILE, 0o600)
    return key


def ask_ai(key, prompt, uno):
    sensors = ", ".join(f"{k}={uno.sensors[k]}" for k in ("t", "h", "light", "water", "sound", "lamp", "pan")
                        if k in uno.sensors) or "not available yet"
    sensors = sensors.replace("t=", "temperature_C=", 1).replace("h=", "humidity_pct=", 1)
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM.format(cap=uno.cap - 20, sensors=sensors,
                                                               time=time.strftime("%H:%M"))}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 300, "temperature": 0.8},
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.load(r)
        return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        print(f"[AI error {e.code}] {detail}")
        if e.code in (400, 401, 403):
            print("If the key is wrong, delete ~/.mini_yaver_key and run me again.")
        return None
    except (ssl.SSLError, urllib.error.URLError) as e:
        print(f"[network] {e}")
        if "CERTIFICATE" in str(e).upper():
            print("Fix: open Finder > Applications > Python 3.x and double-click 'Install Certificates.command'.")
        return None


TRANSLIT = str.maketrans({"ı": "i", "İ": "I", "ş": "s", "Ş": "S", "ğ": "g", "Ğ": "G", "ç": "c", "Ç": "C",
                          "ö": "o", "Ö": "O", "ü": "u", "Ü": "U", "’": "'", "‘": "'", "“": '"', "”": '"',
                          "–": "-", "—": "-", "…": "...", "°": " deg"})

def lcd_text(text):
    text = text.translate(TRANSLIT)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[*#_`>]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def run_tags(text, uno):
    """Do the [LAMP ON] style tags, return the text without them."""
    for tag, arg in re.findall(r"\[(LAMP|PAN|NOD|BEEP)\s*([^\]]*)\]", text, re.I):
        tag, arg = tag.upper(), arg.strip().upper()
        if tag == "LAMP":
            uno.send("RL 1" if arg == "ON" else "RL 0")
        elif tag == "PAN" and re.fullmatch(r"-?\d+", arg):
            uno.send(f"PN {arg}")
        elif tag == "NOD":
            uno.send("ND")
        elif tag == "BEEP":
            uno.send(f"BP {arg if arg.isdigit() else 1}")
        print(f"   -> device: {tag} {arg}")
    return re.sub(r"\[(LAMP|PAN|NOD|BEEP)[^\]]*\]", "", text, flags=re.I)


def answer(uno, key, prompt):
    uno.send("TH")
    print(f"\nYou: {prompt}")
    if "logged period" in prompt:
        log = uno.read_log()
        if log:
            rows = "\n".join(l[4:] for l in log)
            prompt += ("\nLog, oldest first, one row every 10 minutes: index temp_C humidity light_pct "
                       "water_pct noise:\n" + rows)
        else:
            prompt += "\n(The log is still empty: it records one row every 10 minutes.)"
    reply = ask_ai(key, prompt, uno)
    if reply is None:
        uno.send("MS AI error|see the Mac")
        return
    text = lcd_text(run_tags(reply, uno))
    if len(text) > uno.cap:
        text = text[: uno.cap - 3].rsplit(" ", 1)[0] + "..."
    print(f"Yaver: {text}")
    uno.send("AB")
    for i in range(0, len(text), CHUNK):
        uno.send("A " + text[i:i + CHUNK])
    uno.send("AE")

# ------------------------------------------------------------------ main
def main():
    port = find_port()
    print(f"Connecting to the Uno on {port} ...")
    uno = Uno(port)
    key = get_key()

    # Opening the port restarts the Uno; wait for its HELLO.
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            kind, line = uno.events.get(timeout=0.5)
            if kind == "hello":
                print(f"Uno says: {line}")
                break
        except queue.Empty:
            pass
    else:
        uno.send("HI")

    work = queue.Queue()

    def keepalive():                 # the Uno shows "off" if it hears nothing for 20 s
        while True:
            uno.send("TM " + time.strftime("%H:%M"))
            time.sleep(8)

    def events():
        while True:
            kind, line = uno.events.get()
            parts = line.split()
            if parts[0] == "ASK" and len(parts) > 1 and parts[1].isdigit():
                work.put(PRESETS.get(int(parts[1]), PRESETS[0]))
            elif parts[0] == "CARD":
                print(f"[card {parts[3] if len(parts) > 3 else ''} -> preset {parts[2]}]")
            elif parts[0] == "NEWCARD":
                print(f"[new card {parts[1]}: press a digit 0-9 on the remote to bind it]")
            elif parts[0] == "CLAP":
                print("[clap heard]")
            elif kind == "hello":
                print(f"[Uno restarted] {line}")
            else:
                print(f"[uno] {line}")

    def worker():                    # one AI question at a time
        while True:
            prompt = work.get()
            try:
                answer(uno, key, prompt)
            except Exception as e:  # keep the bridge alive
                print(f"[!] {e}")
                uno.send("MS Error|see the Mac")

    for fn in (keepalive, events, worker):
        threading.Thread(target=fn, daemon=True).start()

    print("\nReady. Press 0-9 on the remote, tap a card, or type a question here. /help for commands.\n")
    while True:
        try:
            text = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye.")
            return
        if not text:
            continue
        cmd, _, arg = text.partition(" ")
        if cmd == "/quit":
            return
        elif cmd == "/help":
            print("/lamp on|off  /pan -180..180  /nod  /beep n  /log  /sensors  /clearcards  /quit")
        elif cmd == "/lamp":
            uno.send("RL 1" if arg.strip() == "on" else "RL 0")
        elif cmd == "/pan":
            uno.send(f"PN {arg.strip() or 0}")
        elif cmd == "/nod":
            uno.send("ND")
        elif cmd == "/beep":
            uno.send(f"BP {arg.strip() or 1}")
        elif cmd == "/sensors":
            print(uno.sensors)
        elif cmd == "/log":
            for l in uno.read_log():
                print(l)
        elif cmd == "/clearcards":
            uno.send("CX")
        else:
            work.put(text)


if __name__ == "__main__":
    main()
