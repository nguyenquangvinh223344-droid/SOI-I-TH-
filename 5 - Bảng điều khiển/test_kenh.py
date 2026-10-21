# -*- coding: utf-8 -*-
"""Kiểm thử tự động cho tầng KÊNH. Chỉ làm việc trong thư mục tạm, KHÔNG đụng kho thật.
Chạy:  python -m unittest test_kenh -v
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_BOOT = tempfile.mkdtemp(prefix="kho_boot_")
os.environ["KHO_DIR"] = _BOOT          # đặt trước khi nạp server: nó không bao giờ mở kho thật
os.environ["PORT"] = "8899"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import server as S  # noqa: E402


def touch(p, data=b"x" * 2000):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


class KhoTam(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="kho_test_")).resolve()
        S.ROOT = self.tmp
        S.SYSP = self.tmp / S.SYSD
        S.SYSP.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def p(self, rel):
        return self.tmp.joinpath(*rel.split("/"))

    def dung_kho_cu(self):
        """Dựng kho theo bố cục 1 kênh (trước 21/10)."""
        D = S.D_OUT
        self.f1 = touch(self.p(D + "/1 MODEL/" + S.N_NEW + "/111__1.png"))
        self.f2 = touch(self.p(D + "/2 MODEL/" + S.N_VID + "/222__1.png"))
        self.f3 = touch(self.p(D + "/1 MODEL/" + S.N_USED + "/333__1.png"))
        self.m1 = touch(self.p(S.D_MPICK + "/1 MODEL/a.jpg"))
        self.m2 = touch(self.p(S.D_MPICK + "/2 MODEL/b.jpg"))
        self.v1 = touch(self.p(S.D_VMAU2_ROOT + "/x.mp4"))
        self.v2 = touch(self.p(S.D_POSTED_ROOT + "/y.mp4"))
        self.mau = touch(self.p(S.D_VMAU1 + "/mau.mp4"))
        self.tong = touch(self.p(S.D_MALL + "/tong.jpg"))
        phien = {"111": {"rel": "1 - ẢNH SẢN PHẨM/sp1", "name": "sp1"}}
        (S.SYSP / "_phien.json").write_text(json.dumps(phien, ensure_ascii=False), encoding="utf-8")
        (S.SYSP / "_model_lock.json").write_text(json.dumps({"locked": [S.D_MPICK + "/1 MODEL/a.jpg"]}, ensure_ascii=False), encoding="utf-8")
        (S.SYSP / "_video_jobs.json").write_text(json.dumps([
            {"id": "j1", "img_rel": D + "/1 MODEL/" + S.N_VID + "/zz.png", "result_rel": S.D_VMAU2_ROOT + "/x.mp4"}], ensure_ascii=False), encoding="utf-8")

    def test_1_dời_dữ_liệu_cũ_vào_kênh_mặc_định(self):
        self.dung_kho_cu()
        S.ensure_layout()
        kd = S.kenh_default()
        self.assertEqual(kd, "KENH_1")
        D = S.D_OUT
        self.assertTrue(self.p(D + "/KENH_1/1 MODEL/" + S.N_NEW + "/111__1.png").is_file())
        self.assertTrue(self.p(D + "/KENH_1/2 MODEL/" + S.N_VID + "/222__1.png").is_file())
        self.assertTrue(self.p(D + "/KENH_1/1 MODEL/" + S.N_USED + "/333__1.png").is_file())
        self.assertFalse(self.p(D + "/1 MODEL").exists(), "thư mục 1 MODEL cũ phải biến mất")
        self.assertFalse(self.p(D + "/2 MODEL").exists())
        self.assertTrue(self.p(S.D_MPICK + "/KENH_1/1 MODEL/a.jpg").is_file())
        self.assertTrue(self.p(S.D_MPICK + "/KENH_1/2 MODEL/b.jpg").is_file())
        self.assertTrue(self.p(S.D_VMAU2_ROOT + "/KENH_1/x.mp4").is_file())
        self.assertTrue(self.p(S.D_POSTED_ROOT + "/KENH_1/y.mp4").is_file())
        # dùng chung: không bị dời
        self.assertTrue(self.mau.is_file())
        self.assertTrue(self.tong.is_file())

    def test_2_đủ_thư_mục_cho_cả_3_kênh(self):
        S.ensure_layout()
        for k in ("KENH_1", "KENH_2", "KENH_3"):
            for ln in ("1", "2"):
                for d in S.lane_dirs(k, ln):
                    self.assertTrue(self.p(d).is_dir(), d)
                self.assertTrue(self.p(S.mpick_dir(k, ln)).is_dir())
            self.assertTrue(self.p(S.vout_dir(k)).is_dir())
            self.assertTrue(self.p(S.posted_dir(k)).is_dir())

    def test_3_sửa_đường_dẫn_trong_json_và_có_sao_lưu(self):
        self.dung_kho_cu()
        S.ensure_layout()
        jobs = json.loads((S.SYSP / "_video_jobs.json").read_text(encoding="utf-8"))
        self.assertIn("/KENH_1/1 MODEL/", jobs[0]["img_rel"])
        self.assertEqual(jobs[0]["result_rel"], S.D_VMAU2_ROOT + "/KENH_1/x.mp4")
        lk = json.loads((S.SYSP / "_model_lock.json").read_text(encoding="utf-8"))
        self.assertEqual(lk["locked"], [S.D_MPICK + "/KENH_1/1 MODEL/a.jpg"])
        bks = [x for x in S.SYSP.iterdir() if x.name.startswith("_sao_luu_kenh_")]
        self.assertEqual(len(bks), 1)
        cu = json.loads((bks[0] / "_video_jobs.json").read_text(encoding="utf-8"))
        self.assertNotIn("KENH_1", cu[0]["img_rel"], "bản sao lưu phải còn nguyên bản cũ")
        self.assertTrue((S.SYSP / "_doi_kenh_nhat_ky.json").is_file())

    def test_4_chạy_lại_không_đổi_gì_và_không_lồng_kênh(self):
        self.dung_kho_cu()
        S.ensure_layout()
        # thêm file mới ở kênh 2 rồi chạy lại: kênh 2 không được đụng
        k2 = touch(self.p(S.vout_dir("KENH_2") + "/k2.mp4"))
        S.ensure_layout()
        S.ensure_layout()
        self.assertTrue(k2.is_file())
        self.assertFalse(self.p(S.vout_dir("KENH_1") + "/KENH_1").exists())
        self.assertFalse(self.p(S.vout_dir("KENH_1") + "/KENH_2").exists())
        self.assertFalse(self.p(S.D_OUT + "/KENH_1/KENH_1").exists())
        self.assertTrue(self.p(S.vout_dir("KENH_1") + "/x.mp4").is_file())
        self.assertEqual(len([x for x in S.SYSP.iterdir() if x.name.startswith("_sao_luu_kenh_")]), 1, "chỉ sao lưu 1 lần")

    def test_5_chạy_thử_không_đụng_gì(self):
        self.dung_kho_cu()
        dong = []
        n = S.migrate_kenh(dry=True, say=dong.append)
        self.assertGreater(n, 0)
        self.assertTrue(self.f1.is_file() and self.v1.is_file() and self.m1.is_file(), "chạy thử không được dời file")
        self.assertFalse([x for x in S.SYSP.iterdir() if x.name.startswith("_sao_luu_kenh_")])
        self.assertTrue(any("1 MODEL" in x for x in dong))

    def test_6_hoàn_tác(self):
        self.dung_kho_cu()
        S.ensure_layout()
        n = S.undo_kenh(say=lambda *_: None)
        self.assertGreater(n, 0)
        for f in (self.f1, self.f2, self.f3, self.m1, self.m2, self.v1, self.v2):
            self.assertTrue(f.is_file(), "phải về chỗ cũ: %s" % f)
        jobs = json.loads((S.SYSP / "_video_jobs.json").read_text(encoding="utf-8"))
        self.assertNotIn("KENH_1", jobs[0]["img_rel"])

    def test_7_tên_đường_dẫn_cũ_vẫn_hiểu(self):
        S.ensure_layout()
        kd = S.kenh_default()
        self.assertEqual(S.rel_of(S.safe(S.D_OUT + "/1 MODEL/" + S.N_NEW + "/a.png")), S.D_OUT + "/" + kd + "/1 MODEL/" + S.N_NEW + "/a.png")
        self.assertEqual(S.rel_of(S.safe(S.D_MPICK + "/2 MODEL/b.jpg")), S.D_MPICK + "/" + kd + "/2 MODEL/b.jpg")
        self.assertEqual(S.rel_of(S.safe(S.D_VMAU2_ROOT + "/x.mp4")), S.D_VMAU2_ROOT + "/" + kd + "/x.mp4")
        # đường dẫn đã có kênh (kể cả kênh 2) thì giữ nguyên
        self.assertEqual(S.rel_of(S.safe(S.D_VMAU2_ROOT + "/KENH_2/x.mp4")), S.D_VMAU2_ROOT + "/KENH_2/x.mp4")
        self.assertEqual(S.rel_of(S.safe(S.D_POSTED_ROOT + "/KENH_3/x.mp4")), S.D_POSTED_ROOT + "/KENH_3/x.mp4")
        # tên cũ hơn nữa
        self.assertEqual(S.rel_of(S.safe("ĐÃ PHỐI ĐỒ XONG/MỚI PHỐI LUÔN SẾP!!/a.png")), S.D_NEW1 + "/a.png")

    def test_8_kenh_of_rel(self):
        self.assertEqual(S.kenh_of_rel(S.D_OUT + "/KENH_2/1 MODEL/" + S.N_VID + "/a.png"), "KENH_2")
        self.assertEqual(S.kenh_of_rel(S.D_MPICK + "/KENH_3/2 MODEL/a.jpg"), "KENH_3")
        self.assertEqual(S.kenh_of_rel(S.vout_dir("KENH_1") + "/x.mp4"), "KENH_1")
        self.assertEqual(S.kenh_of_rel(S.posted_dir("KENH_2") + "/x.mp4"), "KENH_2")
        self.assertIsNone(S.kenh_of_rel(S.D_MALL + "/a.jpg"))
        self.assertIsNone(S.kenh_of_rel(S.D_VMAU1 + "/a.mp4"))

    def test_9_danh_sách_kênh_lấy_từ_cấu_hình(self):
        (S.SYSP / "_kenh.json").write_text(json.dumps({"kenh": ["A", "B"], "mac_dinh": "B"}), encoding="utf-8")
        self.assertEqual(S.kenh_list(), ["A", "B"])
        self.assertEqual(S.kenh_default(), "B")
        S.ensure_layout()
        self.assertTrue(self.p(S.vout_dir("A")).is_dir() and self.p(S.vout_dir("B")).is_dir())
        self.assertFalse(self.p(S.vout_dir("KENH_3")).exists())
        # cấu hình hỏng -> quay về mặc định, không làm sập
        (S.SYSP / "_kenh.json").write_text(json.dumps({"kenh": ["A", "A"]}), encoding="utf-8")
        self.assertEqual(S.kenh_list(), ["KENH_1", "KENH_2", "KENH_3"])
        (S.SYSP / "_kenh.json").write_text("{hỏng", encoding="utf-8")
        self.assertEqual(S.kenh_list(), ["KENH_1", "KENH_2", "KENH_3"])

    def test_10_ảnh_model_rời_vẫn_vào_kênh_mặc_định_không_động_kênh_khác(self):
        S.ensure_layout()
        a = touch(self.p(S.D_MPICK + "/rời.jpg"))
        b = touch(self.p(S.mpick_dir("KENH_2", "1") + "/k2.jpg"))
        S.ensure_layout()
        self.assertTrue(self.p(S.D_MPICK1 + "/rời.jpg").is_file())
        self.assertFalse(a.exists())
        self.assertTrue(b.is_file(), "ảnh model của kênh 2 không được bị gom sang kênh 1")


    def chup(self):
        """Ảnh chụp kho: {đường dẫn đầy đủ: nội dung} của mọi file, trừ nhật ký và thư mục sao lưu của chính chương trình dời kênh."""
        out = {}
        for f in sorted(self.tmp.rglob("*")):
            rel = "/".join(f.relative_to(self.tmp).parts)
            if not f.is_file() or "_sao_luu_kenh_" in rel or rel.endswith("_doi_kenh_nhat_ky.json"):
                continue
            out[rel] = f.read_bytes()
        return out

    def test_11_dời_bật_lại_hoàn_tác_về_y_nguyên(self):
        self.dung_kho_cu()
        truoc = self.chup()
        S.ensure_layout()                      # dời
        nk = (S.SYSP / "_doi_kenh_nhat_ky.json").read_bytes()
        S.ensure_layout()                      # bật lại (lần 2, lần 3): không được sửa nhật ký, không sao lưu thêm
        S.ensure_layout()
        self.assertEqual((S.SYSP / "_doi_kenh_nhat_ky.json").read_bytes(), nk, "nhật ký bị sửa khi bật lại")
        self.assertEqual(len([x for x in S.SYSP.iterdir() if x.name.startswith("_sao_luu_kenh_")]), 1, "bật lại không được tạo thêm sao lưu")
        n = S.undo_kenh(say=lambda *_: None)
        self.assertGreater(n, 0)
        self.assertEqual(self.chup(), truoc, "sau hoàn tác, đường dẫn đầy đủ và nội dung mọi file phải giống hệt ban đầu")

    def test_12_không_có_gì_để_dời_thì_không_tạo_sao_lưu(self):
        S.ensure_layout()
        S.ensure_layout()
        self.assertEqual([x for x in S.SYSP.iterdir() if x.name.startswith("_sao_luu_kenh_")], [])
        self.assertFalse((S.SYSP / "_doi_kenh_nhat_ky.json").exists())

    def test_13_hai_lần_dời_cách_nhau_vẫn_không_trùng_tên_sao_lưu(self):
        self.dung_kho_cu()
        S.ensure_layout()
        touch(self.p(S.D_OUT + "/1 MODEL/" + S.N_NEW + "/moi__1.png"))   # lại xuất hiện dữ liệu kiểu cũ trong cùng giây
        S.ensure_layout()
        self.assertEqual(len([x for x in S.SYSP.iterdir() if x.name.startswith("_sao_luu_kenh_")]), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
