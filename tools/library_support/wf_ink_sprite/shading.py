"""Surface-bound, Merian-inspired graphic shading for the WF fill material.

This is a deliberately controlled illustration light, not scene lighting. It
adds form shading and optional hatch marks without changing the world's lights,
the flat base colour, the image texture, or any mesh. Hatch coordinates are the
mesh's generated coordinates or its UVs, never camera/screen coordinates.
"""

import math


_PREFIX = "WF Shadow "
_SCHEMA = 2
_SCHEMA_KEY = "wf_ink_shadow_schema"


def _node(nodes, kind, name, location, frame=None):
    node = nodes.new(kind)
    node.name = _PREFIX + name
    node.label = name
    if frame:
        node.parent = frame
    node.location = location
    return node


def _math(nodes, operation, name, location, frame):
    node = _node(nodes, "ShaderNodeMath", name, location, frame)
    node.operation = operation
    return node


def _range(nodes, name, location, frame):
    node = _node(nodes, "ShaderNodeMapRange", name, location, frame)
    node.clamp = True
    node.interpolation_type = "SMOOTHSTEP"
    node.inputs["To Min"].default_value = 1.0
    node.inputs["To Max"].default_value = 0.0
    return node


def _mask(nodes, links, name, value, location, frame):
    """Keep a smooth range and an exact binary comparison as separate paths.

    A zero transition selects LESS_THAN rather than a degenerate Map Range.
    Render antialiasing may average pixels at boundaries, but mask interiors
    contain no intermediate opacity.
    """
    x, y = location
    soft = _range(nodes, name, (x, y), frame)
    hard = _math(nodes, "LESS_THAN", name + " Hard", (x, y - 190), frame)
    mask = _node(nodes, "ShaderNodeMixRGB", name + " Mask", (x + 220, y), frame)
    mask.blend_type = "MIX"
    mask.use_clamp = False
    links.new(value, soft.inputs["Value"])
    links.new(value, hard.inputs[0])
    links.new(soft.outputs["Result"], mask.inputs[1])
    links.new(hard.outputs[0], mask.inputs[2])
    return mask


def _stripe(nodes, links, name, location, frame):
    """A periodic diagonal stripe, with optional soft edges."""
    x, y = location
    projection = _node(nodes, "ShaderNodeVectorMath", name + " Direction", (x, y), frame)
    projection.operation = "DOT_PRODUCT"
    frequency = _math(nodes, "MULTIPLY", name + " Density", (x + 180, y), frame)
    phase = _math(nodes, "FRACT", name + " Phase", (x + 360, y), frame)
    links.new(projection.outputs["Value"], frequency.inputs[0])
    links.new(frequency.outputs[0], phase.inputs[0])
    stripe = _mask(nodes, links, name + " Stripe", phase.outputs[0], (x + 540, y), frame)
    return projection, stripe


def ensure_shadow_nodes(material):
    """Insert/reuse shading before Emission; return the final colour mix node.

    Only nodes bearing our private prefix are rebuilt. Existing base colour and
    procedural/image texture nodes remain intact, including their links. Older
    WF material graphs are upgraded when this helper is first called.
    """
    if not material or not material.use_nodes or not material.node_tree:
        return None
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    texture = nodes.get("WF Texture Mix")
    if not texture:
        return None
    expected = (
        "Normal", "Light", "Light Range", "Amount", "Deep Amount",
        "Coordinates", "Hatch Direction", "Hatch Density", "Hatch Phase",
        "Hatch Stripe", "Cross Direction", "Cross Density", "Cross Phase",
        "Cross Stripe", "Hatch Amount", "Cross Amount", "Cross Enabled",
        "Hatch Combined", "Dark Fill", "Dark Fill Enabled", "Pattern",
        "Mode", "Strength", "Color",
    ) + tuple(
        name + suffix
        for name in ("Amount", "Deep Amount", "Dark Fill", "Hatch Stripe", "Cross Stripe")
        for suffix in (" Hard", " Mask")
    )
    if material.get(_SCHEMA_KEY) == _SCHEMA and all(
        nodes.get(_PREFIX + name) for name in expected
    ):
        return nodes[_PREFIX + "Color"]

    emission = next((node for node in nodes if node.type == "EMISSION"), None)
    if not emission:
        return None
    previous = nodes.get(_PREFIX + "Color")
    color_input = emission.inputs["Color"]
    upstream = color_input.links[0].from_socket if color_input.is_linked else texture.outputs["Color"]
    if previous and upstream.node == previous:
        upstream = previous.inputs[1].links[0].from_socket if previous.inputs[1].is_linked else texture.outputs["Color"]
    if upstream.node.name.startswith(_PREFIX):
        upstream = texture.outputs["Color"]
    for node in list(nodes):
        if node.name.startswith(_PREFIX):
            nodes.remove(node)

    frame = _node(nodes, "NodeFrame", "Frame", (-900, -900))
    frame.label = "Merian: formskygge og overfladebundet skravering"
    normal = _node(nodes, "ShaderNodeNewGeometry", "Normal", (0, 500), frame)
    light = _node(nodes, "ShaderNodeVectorMath", "Light", (180, 500), frame)
    light.operation = "DOT_PRODUCT"
    light_range = _math(nodes, "MULTIPLY_ADD", "Light Range", (360, 500), frame)
    light_range.inputs[1].default_value = 0.5
    light_range.inputs[2].default_value = 0.5
    links.new(normal.outputs["Normal"], light.inputs[0])
    links.new(light.outputs["Value"], light_range.inputs[0])
    amount = _mask(nodes, links, "Amount", light_range.outputs[0], (540, 500), frame)
    deep = _mask(nodes, links, "Deep Amount", light_range.outputs[0], (540, 100), frame)
    darkest = _mask(nodes, links, "Dark Fill", light_range.outputs[0], (540, -300), frame)

    coordinates = _node(nodes, "ShaderNodeTexCoord", "Coordinates", (0, -800), frame)
    hatch_dir, hatch = _stripe(nodes, links, "Hatch", (180, -800), frame)
    cross_dir, cross = _stripe(nodes, links, "Cross", (180, -1200), frame)
    links.new(coordinates.outputs["Generated"], hatch_dir.inputs[0])
    links.new(coordinates.outputs["Generated"], cross_dir.inputs[0])
    hatch_amount = _math(nodes, "MULTIPLY", "Hatch Amount", (1160, 500), frame)
    cross_amount = _math(nodes, "MULTIPLY", "Cross Amount", (1160, 100), frame)
    cross_enabled = _math(nodes, "MULTIPLY", "Cross Enabled", (1340, 100), frame)
    combined = _math(nodes, "MAXIMUM", "Hatch Combined", (1520, 500), frame)
    dark_fill = _math(nodes, "MULTIPLY", "Dark Fill Enabled", (1340, -300), frame)
    pattern = _math(nodes, "MAXIMUM", "Pattern", (1700, 500), frame)
    links.new(amount.outputs["Color"], hatch_amount.inputs[0])
    links.new(hatch.outputs["Color"], hatch_amount.inputs[1])
    links.new(deep.outputs["Color"], cross_amount.inputs[0])
    links.new(cross.outputs["Color"], cross_amount.inputs[1])
    links.new(cross_amount.outputs[0], cross_enabled.inputs[0])
    links.new(hatch_amount.outputs[0], combined.inputs[0])
    links.new(cross_enabled.outputs[0], combined.inputs[1])
    links.new(darkest.outputs["Color"], dark_fill.inputs[0])
    links.new(combined.outputs[0], pattern.inputs[0])
    links.new(dark_fill.outputs[0], pattern.inputs[1])
    mode = _node(nodes, "ShaderNodeMixRGB", "Mode", (1890, 500), frame)
    mode.blend_type = "MIX"
    links.new(amount.outputs["Color"], mode.inputs[1])
    links.new(pattern.outputs[0], mode.inputs[2])
    strength = _math(nodes, "MULTIPLY", "Strength", (2090, 500), frame)
    links.new(mode.outputs["Color"], strength.inputs[0])
    color = _node(nodes, "ShaderNodeMixRGB", "Color", (2290, 500), frame)
    color.blend_type = "MIX"
    color.use_clamp = False
    links.new(strength.outputs[0], color.inputs[0])
    links.new(upstream, color.inputs[1])
    for link in list(color_input.links):
        links.remove(link)
    links.new(color.outputs["Color"], color_input)
    # Upgrading alone leaves the old fill unchanged until settings are applied.
    strength.inputs[1].default_value = 0.0
    material[_SCHEMA_KEY] = _SCHEMA
    return color


def update_shadow_nodes(material, settings):
    """Apply the scene's WF shadow settings without mutating scene lighting."""
    color = ensure_shadow_nodes(material)
    if color is None:
        return
    color.use_clamp = False
    tree = material.node_tree
    nodes = tree.nodes
    lookup = lambda name: nodes[_PREFIX + name]
    mode = getattr(settings, "shadow_mode", "OFF")
    lookup("Mode").inputs[0].default_value = 1.0 if mode == "HATCH" else 0.0
    lookup("Strength").inputs[1].default_value = (
        0.0 if mode == "OFF" else min(1.0, max(0.0, settings.shadow_strength))
    )
    color.inputs[2].default_value = settings.ink_color
    azimuth = math.radians(settings.shadow_azimuth)
    elevation = math.radians(settings.shadow_elevation)
    lookup("Light").inputs[1].default_value = (
        math.sin(azimuth) * math.cos(elevation),
        -math.cos(azimuth) * math.cos(elevation),
        math.sin(elevation),
    )
    threshold = min(1.0, max(0.0, settings.shadow_threshold))
    hard_edges = settings.shadow_softness <= 0.0
    # The unused smooth path retains a valid nonzero range at hard transition.
    softness = max(0.000001, settings.shadow_softness)
    for name, shift in (("Amount", 0.0), ("Deep Amount", 0.22), ("Dark Fill", 0.38)):
        node = lookup(name)
        center = threshold - shift
        node.inputs["From Min"].default_value = center - softness
        node.inputs["From Max"].default_value = center + softness
        lookup(name + " Hard").inputs[1].default_value = center
        lookup(name + " Mask").inputs[0].default_value = float(hard_edges)
    lookup("Cross Enabled").inputs[1].default_value = float(settings.hatch_cross)
    lookup("Dark Fill Enabled").inputs[1].default_value = float(
        getattr(settings, "hatch_dark_fill", False)
    )
    use_uv = settings.hatch_coordinates == "UV"
    coordinate_output = lookup("Coordinates").outputs["UV" if use_uv else "Generated"]
    directions = ((1.0, 1.0, 0.0), (1.0, -1.0, 0.0)) if use_uv else (
        (1.0, 0.35, 1.0), (1.0, 0.35, -1.0)
    )
    density = max(0.1, settings.hatch_density)
    width = min(0.8, max(0.01, settings.hatch_width))
    feather = min(0.025, width * 0.15)
    for name, direction in zip(("Hatch", "Cross"), directions):
        projection = lookup(name + " Direction")
        projection.inputs[1].default_value = direction
        for link in list(projection.inputs[0].links):
            tree.links.remove(link)
        tree.links.new(coordinate_output, projection.inputs[0])
        lookup(name + " Density").inputs[1].default_value = density
        stripe = lookup(name + " Stripe")
        stripe.inputs["From Min"].default_value = width - feather
        stripe.inputs["From Max"].default_value = width + feather
        lookup(name + " Stripe Hard").inputs[1].default_value = width
        lookup(name + " Stripe Mask").inputs[0].default_value = float(hard_edges)

