# Nemo Ops

A harbour acoustic-monitoring console for the Port of Los Angeles: hub on the left,
map on the right. Hackathon demo (InnovateLA Dual-Use). **All data is simulated**; the
backend lives in a separate repository.

Layers: 1 basemap and places, 2 equipment (fibre ducts, DAS coverage, hydrophones),
3 contacts, 4 sound classes and icons, 5 acoustic array replay.

Run locally (no build step, works offline):

    py -m http.server 8767 --bind 127.0.0.1

then open http://127.0.0.1:8767.

Map imagery: USDA, USGS The National Map: Orthoimagery (public domain).
Chart: NOAA Office of Coast Survey (public domain). Not for navigation.
