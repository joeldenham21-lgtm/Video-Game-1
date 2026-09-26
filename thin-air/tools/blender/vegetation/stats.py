"""Triangle breakdown of generated trees (QA).  blender -b -P stats.py -- --only=spruce_a"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vegcommon as vc  # noqa: E402
import trees  # noqa: E402


def main():
	a = vc.parse_args()
	cm = trees.load_cards_meta()
	mm = trees.load_material_meta()
	for name in [s for s in a.get("only", "spruce_a").split(",") if s]:
		built = trees.build_variant(name, cm, mm)
		for i, md in enumerate(built["lods"]):
			bark = sum(len(f) - 2 for f, m in zip(md.faces, md.mat) if m == 0)
			cards = sum(len(f) - 2 for f, m in zip(md.faces, md.mat) if m == 1)
			print(f"[stats] {name} LOD{i}: bark {bark} cards {cards} total {bark + cards}")
		t = built["tree"]
		live = [b for b in t.branches if b.pts is not None and not b.dead]
		dead = [b for b in t.branches if b.pts is not None and b.dead]
		ncards = sum(len(b.cards0) for b in t.branches)
		print(f"[stats] {name}: branches live {len(live)} dead {len(dead)} cards {ncards} mul {built['meta']['card_spacing_mul']}")


if __name__ == "__main__":
	main()
