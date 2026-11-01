import json
import shutil
import subprocess
import sys
from pathlib import Path

MODELS_ROOT = Path.home() / ".paddlex" / "official_models"
OUT_DIR = Path(__file__).resolve().parent.parent / "resources" / "models"
OUT_DIR.mkdir(parents=True, exist_ok=True)

PADDLE2ONNX_EXE = shutil.which("paddle2onnx")
if PADDLE2ONNX_EXE is None:
    print("ERROR: paddle2onnx console script not found on PATH. "
          "pip install paddle2onnx==1.3.1 into the active environment first.",
          file=sys.stderr)
    sys.exit(1)

EXPORTS = [
    ("PP-OCRv5_server_det", "det.onnx"),
    ("eslav_PP-OCRv5_mobile_rec", "rec.onnx"),
    ("PP-DocLayout_plus-L", "layout.onnx"),
]

for model_name, out_name in EXPORTS:
    model_dir = MODELS_ROOT / model_name
    if not model_dir.exists():
        print(f"ERROR: {model_dir} not found. Run PaddleOCR(lang='ru') and "
              f"PPStructureV3(lang='ru', use_region_detection=False) once to "
              f"download it.", file=sys.stderr)
        sys.exit(1)
    out_path = OUT_DIR / out_name
    subprocess.run(
        [
            PADDLE2ONNX_EXE,
            "--model_dir", str(model_dir),
            "--model_filename", "inference.json",
            "--params_filename", "inference.pdiparams",
            "--save_file", str(out_path),
        ],
        check=True,
    )
    print(f"exported {model_dir.name} -> {out_path}")

# Recognizer dictionary: PaddleOCR's BaseRecLabelDecode appends a literal
# space character (use_space_char=True by default) before CTCLabelDecode
# prepends the blank token at index 0. So the real class layout is:
#   index 0            -> blank
#   index 1..N         -> character_dict[0..N-1]
#   index N+1 (last)   -> ' ' (space, appended here, not in character_dict)
# Verified empirically against rec.onnx: character_dict had 517 entries,
# the exported model has 519 output classes (517 + blank + space).
rec_config = json.loads((MODELS_ROOT / "eslav_PP-OCRv5_mobile_rec" / "config.json").read_text(encoding="utf-8"))
chars = rec_config["PostProcess"]["character_dict"] + [" "]
dict_path = Path(__file__).resolve().parent.parent / "resources" / "eslav-dict.txt"
dict_path.write_bytes(("\n".join(chars) + "\n").encode("utf-8"))
print(f"wrote {len(chars)} characters (including trailing space) -> {dict_path}")
