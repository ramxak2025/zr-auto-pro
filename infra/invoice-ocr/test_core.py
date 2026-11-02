import base64
import io
import json
import unittest
from PIL import Image
from ocr_core import OcrError, decode_image, protect_numeric_cells, header_columns, MAX_BYTES
from worker import RequestError, parse_body


def table(qty="2", price="450,00", total="900,00", confidence=96):
    headers = ["Наименование", "Кол-во", "Цена", "Сумма"]
    values = ["Фильтр", qty, price, total]
    return {"cells": [{"rowIndex": str(r), "columnIndex": str(c), "text": value, "confidence": confidence}
                      for r, row in enumerate((headers, values)) for c, value in enumerate(row)]}


class CoreTests(unittest.TestCase):
    def test_low_confidence_is_not_inferred_from_total(self):
        value = table()
        value["cells"][5]["confidence"] = 79
        protect_numeric_cells(value)
        self.assertEqual(value["cells"][5]["text"], "")
        self.assertEqual(value["cells"][5]["rawText"], "2")
        self.assertTrue(value["cells"][5]["warnings"])

    def test_mismatched_total_blanks_both_numbers_without_repair(self):
        value = table(qty="7")
        protect_numeric_cells(value)
        self.assertEqual([value["cells"][c]["text"] for c in (5, 6)], ["", ""])
        self.assertEqual(value["cells"][5]["rawText"], "7")

    def test_numeric_invalids_zero_and_precision(self):
        for raw in ("O", "1O", "-2", "2; rm -rf /", "NaN", "1e3", "0", "1000000000"):
            value = table(qty=raw)
            protect_numeric_cells(value)
            self.assertEqual(value["cells"][5]["text"], "", raw)
        value = table(price="0", total="0")
        protect_numeric_cells(value)
        self.assertEqual(value["cells"][6]["text"], "0")
        value = table(price="1,234", total="2,468")
        protect_numeric_cells(value)
        self.assertEqual(value["cells"][6]["text"], "")

    def test_fractional_quantity_and_shuffled_header(self):
        value = table(qty="1,5", price="100,00", total="150,00")
        protect_numeric_cells(value)
        self.assertEqual(value["cells"][5]["text"], "1,5")
        value["cells"] = list(reversed(value["cells"]))
        self.assertEqual(header_columns(value)[1]["qty"], 1)

    def test_untrusted_envelopes_never_become_urls_or_cli_args(self):
        for value in ({"url": "https://example.com/private"}, {"imageBase64": "http://x"},
                      {"imageBase64": "aGVsbG8=", "args": ["--psm", "0"]}, ["anything"], None):
            with self.assertRaises(RequestError):
                parse_body(json.dumps(value).encode(), "application/json")
        self.assertEqual(parse_body(b'{"imageBase64":"aGVsbG8="}', "application/json"), b"hello")

    def test_input_caps_and_malformed_image(self):
        for data in (b"", b"not an image", b"\x89PNG\r\n\x1a\n"+b"bad"*20):
            with self.assertRaises(OcrError):
                decode_image(data)
        with self.assertRaises(RequestError):
            parse_body(b"a"*(MAX_BYTES+1), "image/jpeg")
        with self.assertRaises(RequestError):
            parse_body(b"hello", "text/uri-list")

    def test_pixel_limit_before_full_decode_and_animation_rejected(self):
        buffer = io.BytesIO()
        Image.new("L", (5000, 4001), 255).save(buffer, "PNG")
        with self.assertRaises(OcrError):
            decode_image(buffer.getvalue())
        buffer = io.BytesIO()
        Image.new("RGB", (40, 40), "white").save(buffer, "GIF")
        with self.assertRaises(OcrError):
            decode_image(buffer.getvalue())

    def test_exif_orientation_is_applied(self):
        image = Image.new("RGB", (80, 40), "white")
        exif = image.getexif()
        exif[274] = 6
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", exif=exif)
        self.assertEqual(decode_image(buffer.getvalue()).shape, (80, 40))


if __name__ == "__main__":
    unittest.main()
