# sci_movement_tracker_fe

React front end for the NeuroMotion SCI tracker.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

Start the backend (`sci_movement_tracker_be`, `python main.py`) on port 8000 first. In dev, Vite proxies
`/api`, `/live` and `/ws` to it. For another backend URL, set `VITE_API_URL` in `.env.local`.

## Two tracking engines

| Engine | Runs | Gives | Best for |
|---|---|---|---|
| Browser (MediaPipe) | in Chrome, nothing to install | approximate 3D: rotations, pronation, neck turn | quick use, any computer |
| Python (RTMPose) | in the backend, on your computer | accurate 2D in the camera's plane, hands, feet | precise flexion/extension (side view) or abduction (front view) |

Switch with the **Engine** buttons. Recording, voice control ("Hagop" / "stop"), live movements and the
reports work the same with both.

## Sensitivity

**High** catches slow, small movements (a weak hip flexion of a few degrees over seconds), with more
false alarms; **Low** reports only clear movements. It applies to the live panel and to the analysis of
each recording.

## Tests

```bash
npm test             # angle math (101 checks), left/right swap fix, live movement detector
npm run docs:angles  # regenerate docs/JOINT_ANGLES.md
```
