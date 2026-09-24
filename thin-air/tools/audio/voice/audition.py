#!/usr/bin/env python3
"""Second-stage casting: render a character line for shortlisted speakers, measure noise floor (SNR),
F0 statistics and write spectrogram PNGs for visual inspection.

  python3.12 thin-air/tools/audio/voice/audition.py <out_dir>
"""
import json
import os
import subprocess
import sys

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from lib import spec as specpng  # noqa: E402
from voice.cast_voices import yin  # noqa: E402

PIPER = "/opt/piper/piper/piper"
MODEL = "/opt/piper/en-us-libritts-high.onnx"

SHORTLIST = {
	"dale": ([700, 432, 410, 800], "Sam, you still with me back there? That's the Aldous coming up on the right. Forty minutes to the glacier, if this holds."),
	"burke": ([800, 432, 570], "Grey's been around the mine all month. Big old boar, scar on his shoulder. Leave him alone and he'll leave you alone. Burke out."),
	"hale": ([738, 770, 330, 360], "I'm very cold, and I'm very tired, and I know what that means. Tell my sister it was beautiful, before the cloud came in."),
	"reyes": ([600, 402, 203, 70], "The blue one is Christmas lights. Don't ask. I'm praying to the patron saint of Kubota."),
	"rescue": ([854, 750, 257], "Kestrel Station, Terrace Rescue. We read you, weak but readable. Go ahead."),
	"heli": ([20, 660, 190], "Kestrel, One-Six. I have you in sight. Two minutes."),
	"mara": ([240, 710, 130, 80, 0], "Okay. Hi. My name's Mara Voss. You were on the plane. I heard it go over, and then I heard it stop."),
	"dispatch": ([620, 160, 880, 120], "Kilo Tango Lima, Terrace Dispatch. Go ahead, Dale. Still nothing from the crew."),
	"park": ([118, 850, 780, 420], "Tomas died last night. I'm going to try the east moraine at first light. Tell Mara the line she drew was right."),
	"awos": ([500, 220], "Kestrel Station, automated weather. Wind, two six zero at four two, gusting five five."),
}


def main():
	out = sys.argv[1]
	os.makedirs(out, exist_ok=True)
	jobs = []
	for role, (ids, text) in SHORTLIST.items():
		for sid in ids:
			p = os.path.join(out, f"{role}_{sid:03d}.wav")
			if not os.path.exists(p):
				jobs.append(json.dumps({"text": text, "speaker_id": sid, "output_file": p}))
	if jobs:
		subprocess.run([PIPER, "--model", MODEL, "--json-input", "-q", "--sentence_silence", "0.45"],
			input="\n".join(jobs) + "\n", text=True, check=True, capture_output=True)
	report = {}
	for role, (ids, _) in SHORTLIST.items():
		for sid in ids:
			p = os.path.join(out, f"{role}_{sid:03d}.wav")
			sr, x = wavfile.read(p)
			x = x.astype(np.float64) / 32768.0
			fr = int(0.02 * sr)
			rms = np.sqrt(np.convolve(x * x, np.ones(fr) / fr, mode="valid")[::fr // 2] + 1e-12)
			snr = 20 * np.log10(np.percentile(rms, 90) / max(np.percentile(rms, 8), 1e-6))
			f0, ap = yin(x, sr)
			hf = np.abs(np.fft.rfft(x))
			f = np.fft.rfftfreq(len(x), 1 / sr)
			air = 10 * np.log10(np.sum(hf[f > 6000] ** 2) / np.sum(hf[(f > 200) & (f < 4000)] ** 2))
			report[f"{role}_{sid}"] = {"snr_db": round(float(snr), 1), "f0": round(float(np.median(f0)), 1),
				"range_st": round(float(12 * np.log2(np.percentile(f0, 90) / np.percentile(f0, 10))), 1),
				"air_db": round(float(air), 1), "dur": round(len(x) / sr, 2)}
			y = np.interp(np.arange(0, len(x), sr / 44100.0), np.arange(len(x)), x)
			specpng.render(y, os.path.join(out, f"{role}_{sid:03d}.png"), f"{role} {sid}", 800, 160)
			print(f"{role:9s} {sid:4d}  snr={snr:5.1f} dB  f0={np.median(f0):6.1f}  range={report[f'{role}_{sid}']['range_st']:5.1f}st  air={air:6.1f} dB  dur={len(x)/sr:5.2f}s")


if __name__ == "__main__":
	main()
