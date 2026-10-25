# Joint and segment angles

Generated from `src/lib/angles.ts` by `npm run docs:angles`. Do not edit by hand.

Every channel is recorded per frame. A value is empty (null) when the points it needs are not clearly
inside the picture. Nothing is guessed.

## How the angles are defined

- **Joint angles** are one segment relative to the next (hip flexion = thigh relative to trunk).
- **Segment angles** (`*_incl`, trunk lean) are one segment relative to vertical, taken from the camera, so keep
  the camera level. Comparing them shows whether the thigh or the trunk produced a hip movement.
- **Reference frame**: the trunk frame needs both hips and shoulders in the picture. When the hips are hidden,
  a shoulders-only frame is used: arms, hands, neck and shoulder girdle are still measured; hips, knees, ankles,
  trunk and pelvis are not.
- **Neutral posture**: neck movements and shoulder shrug/protraction have no anatomical zero. Press
  "Set neutral posture" while still in a normal posture; those channels are then measured from it.
- **Hands**: finger channels need the MediaPipe hand model to find the hand. Without it, wrist and forearm use
  the three hand points of the body model (lower accuracy) and fingers are empty.
- **Left/right** are the person's own sides. A continuity check swaps them back if the model suddenly
  exchanges the two arms or legs.
- **Not measurable from video with this model**: toe joints (one point per foot), scapular rotation, spinal
  segment-by-segment motion.

## Reliability

- **good**: large joints moving in the camera's view plane.
- **fair**: depends on camera angle or on small points (hand, foot, head).
- **low**: movements mostly toward or away from a single camera (rotations, inversion, protraction), or very
  small segments. Treat as indicative until validated with several cameras.

None of these have been validated against a goniometer or lab motion capture yet.

## Each side (`left.` / `right.`)

| Channel | Movement | Group | Unit | Sign | Reliability |
|---|---|---|---|---|---|
| `{side}.shoulder_elevation` | Shoulder shrug | Shoulder girdle | % | + up (set neutral first) | fair |
| `{side}.shoulder_protraction` | Shoulder protraction | Shoulder girdle | degrees | + forward | low |
| `{side}.shoulder_flexion` | Shoulder flexion | Shoulder | degrees | + forward / − back | good |
| `{side}.shoulder_abduction` | Shoulder abduction | Shoulder | degrees | + out / − across | good |
| `{side}.shoulder_rotation` | Shoulder rotation | Shoulder | degrees | + external (elbow bent ≥30°) | fair |
| `{side}.elbow_flexion` | Elbow flexion | Elbow & forearm | degrees | 0 = straight | good |
| `{side}.forearm_pronation` | Forearm pronation | Elbow & forearm | degrees | + palm down / − palm up (elbow bent ≥30°) | fair |
| `{side}.wrist_flexion` | Wrist flexion | Wrist | degrees | + flexion / − extension | fair |
| `{side}.wrist_radial_deviation` | Wrist deviation | Wrist | degrees | + radial / − ulnar | low |
| `{side}.thumb_cmc` | Thumb CMC | Fingers | degrees | bend (unsigned) | low |
| `{side}.thumb_mcp` | Thumb MCP | Fingers | degrees | bend (unsigned) | low |
| `{side}.thumb_ip` | Thumb IP | Fingers | degrees | bend (unsigned) | low |
| `{side}.index_mcp` | Index MCP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.index_pip` | Index PIP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.index_dip` | Index DIP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.middle_mcp` | Middle MCP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.middle_pip` | Middle PIP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.middle_dip` | Middle DIP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.ring_mcp` | Ring MCP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.ring_pip` | Ring PIP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.ring_dip` | Ring DIP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.little_mcp` | Little MCP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.little_pip` | Little PIP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.little_dip` | Little DIP | Fingers | degrees | + flexion / − hyperextension | fair |
| `{side}.thumb_abduction` | Thumb abduction | Fingers | degrees | thumb–index metacarpal angle | low |
| `{side}.spread_index_middle` | Spread index–middle | Fingers | degrees |  | low |
| `{side}.spread_middle_ring` | Spread middle–ring | Fingers | degrees |  | low |
| `{side}.spread_ring_little` | Spread ring–little | Fingers | degrees |  | low |
| `{side}.pinch_aperture` | Pinch opening | Fingers | % | thumb–index tip gap, % of hand length | fair |
| `{side}.hip_flexion` | Hip flexion | Hip | degrees | + forward / − back (vs trunk) | good |
| `{side}.hip_abduction` | Hip abduction | Hip | degrees | + out / − across | fair |
| `{side}.hip_rotation` | Hip rotation | Hip | degrees | + internal / − external | low |
| `{side}.knee_flexion` | Knee flexion | Knee | degrees | 0 = straight | good |
| `{side}.ankle_dorsiflexion` | Ankle dorsiflexion | Ankle & foot | degrees | + up / − pointed | fair |
| `{side}.ankle_inversion` | Ankle inversion | Ankle & foot | degrees | + sole in / − sole out | low |
| `{side}.foot_progression` | Foot progression | Ankle & foot | degrees | + toes out / − toes in | fair |
| `{side}.thigh_incl` | Thigh vs vertical | Segments | degrees | + forward | good |
| `{side}.shank_incl` | Shank vs vertical | Segments | degrees | + forward | good |

## Head, trunk and pelvis (`axial.`)

| Channel | Movement | Group | Unit | Sign | Reliability |
|---|---|---|---|---|---|
| `axial.neck_flexion` | Neck flexion | Head & neck | degrees | + chin down | fair |
| `axial.neck_lateral_flexion` | Neck side bend | Head & neck | degrees | + to the right | fair |
| `axial.neck_rotation` | Neck rotation | Head & neck | degrees | + to the right | fair |
| `axial.trunk_flexion` | Trunk forward lean | Trunk & pelvis | degrees | + forward (vs vertical) | fair |
| `axial.trunk_lean` | Trunk tilt (any direction) | Trunk & pelvis | degrees |  | fair |
| `axial.trunk_lateral_lean` | Trunk side lean | Trunk & pelvis | degrees | + to the right | good |
| `axial.trunk_rotation` | Trunk rotation | Trunk & pelvis | degrees | + shoulders turned right vs pelvis | fair |
| `axial.pelvic_obliquity` | Pelvic obliquity | Trunk & pelvis | degrees | + right hip higher | fair |
| `axial.pelvic_rotation` | Pelvis rotation | Trunk & pelvis | degrees | + turned right (vs camera) | low |

## Checks

`npm test` builds poses with known joint angles for every movement above (both sides) and checks the code
returns them within 1.5 degrees with the documented sign, plus the left/right swap correction.
