"""Cycles materials that mirror the in-game shaders closely enough for previews and impostor baking:
bark = bark_* albedo/normal with metre UVs * uv1_scale, cards = foliage atlas albedo with alpha cut-out,
both multiplied by the baked vertex AO (COLOR_0.g)."""
from __future__ import annotations

import os

import bpy

import vegcommon as vc


def _img(path: str, non_color: bool = False):
	img = bpy.data.images.load(path, check_existing=True)
	if non_color:
		img.colorspace_settings.name = "Non-Color"
	return img


def bark_material(set_name: str, tint=(1.0, 1.0, 1.0), uv_scale=(2.0, 1.0), with_ao: bool = True) -> bpy.types.Material:
	name = f"bmat_{set_name}_{tint[0]:.2f}"
	m = bpy.data.materials.get(name)
	if m:
		return m
	m = bpy.data.materials.new(name)
	m.use_nodes = True
	nt = m.node_tree
	bsdf = nt.nodes["Principled BSDF"]
	tex_dir = os.path.join(vc.PROJECT, "assets", "textures", set_name)
	uv = nt.nodes.new("ShaderNodeUVMap")
	uv.uv_map = "UVMap"
	mp = nt.nodes.new("ShaderNodeMapping")
	mp.inputs["Scale"].default_value = (uv_scale[0], uv_scale[1], 1.0)
	nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
	alb = nt.nodes.new("ShaderNodeTexImage")
	alb.image = _img(os.path.join(tex_dir, f"{set_name}_albedo.png"))
	nt.links.new(mp.outputs["Vector"], alb.inputs["Vector"])
	col = alb.outputs["Color"]
	tint_node = nt.nodes.new("ShaderNodeMix")
	tint_node.data_type = "RGBA"
	tint_node.blend_type = "MULTIPLY"
	tint_node.inputs["Factor"].default_value = 1.0
	tint_node.inputs[7].default_value = (tint[0], tint[1], tint[2], 1.0)
	nt.links.new(col, tint_node.inputs[6])
	col = tint_node.outputs[2]
	if with_ao:
		vcn = nt.nodes.new("ShaderNodeVertexColor")
		vcn.layer_name = "Col"
		sep = nt.nodes.new("ShaderNodeSeparateColor")
		nt.links.new(vcn.outputs["Color"], sep.inputs["Color"])
		mul = nt.nodes.new("ShaderNodeMix")
		mul.data_type = "RGBA"
		mul.blend_type = "MULTIPLY"
		mul.inputs["Factor"].default_value = 1.0
		nt.links.new(col, mul.inputs[6])
		nt.links.new(sep.outputs["Green"], mul.inputs[7])
		col = mul.outputs[2]
	nt.links.new(col, bsdf.inputs["Base Color"])
	nrm_path = os.path.join(tex_dir, f"{set_name}_normal.png")
	if os.path.exists(nrm_path):
		nimg = nt.nodes.new("ShaderNodeTexImage")
		nimg.image = _img(nrm_path, True)
		nt.links.new(mp.outputs["Vector"], nimg.inputs["Vector"])
		nm = nt.nodes.new("ShaderNodeNormalMap")
		nt.links.new(nimg.outputs["Color"], nm.inputs["Color"])
		nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
	bsdf.inputs["Roughness"].default_value = 0.85
	return m


def card_material(set_name: str, with_ao: bool = True, normal_map: bool = True) -> bpy.types.Material:
	name = f"cmat_{set_name}"
	m = bpy.data.materials.get(name)
	if m:
		return m
	m = bpy.data.materials.new(name)
	m.use_nodes = True
	m.blend_method = "CLIP"
	nt = m.node_tree
	out = nt.nodes["Material Output"]
	bsdf = nt.nodes["Principled BSDF"]
	uv = nt.nodes.new("ShaderNodeUVMap")
	uv.uv_map = "UVMap"
	alb = nt.nodes.new("ShaderNodeTexImage")
	alb.image = _img(os.path.join(vc.TEX_FOLIAGE, f"{set_name}_albedo.png"))
	alb.interpolation = "Linear"
	nt.links.new(uv.outputs["UV"], alb.inputs["Vector"])
	col = alb.outputs["Color"]
	if with_ao:
		vcn = nt.nodes.new("ShaderNodeVertexColor")
		vcn.layer_name = "Col"
		sep = nt.nodes.new("ShaderNodeSeparateColor")
		nt.links.new(vcn.outputs["Color"], sep.inputs["Color"])
		mul = nt.nodes.new("ShaderNodeMix")
		mul.data_type = "RGBA"
		mul.blend_type = "MULTIPLY"
		mul.inputs["Factor"].default_value = 1.0
		nt.links.new(col, mul.inputs[6])
		nt.links.new(sep.outputs["Green"], mul.inputs[7])
		col = mul.outputs[2]
	nt.links.new(col, bsdf.inputs["Base Color"])
	if normal_map:
		nimg = nt.nodes.new("ShaderNodeTexImage")
		nimg.image = _img(os.path.join(vc.TEX_FOLIAGE, f"{set_name}_normal.png"), True)
		nt.links.new(uv.outputs["UV"], nimg.inputs["Vector"])
		nm = nt.nodes.new("ShaderNodeNormalMap")
		nm.inputs["Strength"].default_value = 0.6
		nt.links.new(nimg.outputs["Color"], nm.inputs["Color"])
		nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
	bsdf.inputs["Roughness"].default_value = 0.65
	try:
		bsdf.inputs["Subsurface Weight"].default_value = 0.0
	except KeyError:
		pass
	# alpha cut-out: threshold like the game shader (alpha scissor 0.5)
	gt = nt.nodes.new("ShaderNodeMath")
	gt.operation = "GREATER_THAN"
	gt.inputs[1].default_value = 0.5
	nt.links.new(alb.outputs["Alpha"], gt.inputs[0])
	tr = nt.nodes.new("ShaderNodeBsdfTransparent")
	mix = nt.nodes.new("ShaderNodeMixShader")
	nt.links.new(gt.outputs[0], mix.inputs["Fac"])
	nt.links.new(tr.outputs[0], mix.inputs[1])
	nt.links.new(bsdf.outputs[0], mix.inputs[2])
	nt.links.new(mix.outputs[0], out.inputs["Surface"])
	return m
