// Writes docs/JOINT_ANGLES.md from the channel registry so the docs never drift from the code.
// Run: npm run docs:angles
import { writeFileSync } from 'node:fs';
import { AXIAL_CHANNELS, SIDE_CHANNELS } from '../src/lib/angles';

const row = (prefix: string, c: (typeof SIDE_CHANNELS)[number]) =>
  `| \`${prefix}${c.key}\` | ${c.label} | ${c.group} | ${c.unit === '%' ? '%' : 'degrees'} | ${c.sign ?? ''} | ${c.reliability} |`;

const md = `# Joint and segment angles

Generated from \`src/lib/angles.ts\` by \`npm run docs:angles\`. Do not edit by hand.

Every channel is recorded per frame. A value is empty (null) when the points it needs are not clearly
inside the picture. Nothing is guessed.

## How the angles are defined

- **Joint angles** are one segment relative to the next (hip flexion = thigh relative to trunk).
- **Segment angles** (\`*_incl\`, trunk lean) are one segment relative to vertical, taken from the camera, so keep
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

## Each side (\`left.\` / \`right.\`)

| Channel | Movement | Group | Unit | Sign | Reliability |
|---|---|---|---|---|---|
${SIDE_CHANNELS.map((c) => row('{side}.', c)).join('\n')}

## Head, trunk and pelvis (\`axial.\`)

| Channel | Movement | Group | Unit | Sign | Reliability |
|---|---|---|---|---|---|
${AXIAL_CHANNELS.map((c) => row('axial.', c)).join('\n')}

## Checks

\`npm test\` builds poses with known joint angles for every movement above (both sides) and checks the code
returns them within 1.5 degrees with the documented sign, plus the left/right swap correction.
`;
writeFileSync('docs/JOINT_ANGLES.md', md);
console.log(`docs/JOINT_ANGLES.md: ${SIDE_CHANNELS.length * 2 + AXIAL_CHANNELS.length} channels`);
