export type FieldLocation = { latitude: number; longitude: number; capturedAt: string };

// One GPS capture for every field flow (vehicle custody, house verification).
// Works in the phone browser over HTTPS and inside the Capacitor APK, whose WebView asks Android for permission.
export async function readDeviceLocation(): Promise<FieldLocation> {
  if (!navigator.geolocation) throw new Error('This device cannot provide a location. Use a GPS-enabled Android phone.');
  // Browsers only expose geolocation on a secure origin; name the real cause instead of a silent failure.
  if (!window.isSecureContext) throw new Error('Location needs a secure (HTTPS) connection. Open this app using its https:// address, then capture again.');
  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 }));
    return { latitude: position.coords.latitude, longitude: position.coords.longitude, capturedAt: new Date().toISOString() };
  } catch (error) {
    const code = (error as GeolocationPositionError | undefined)?.code;
    throw new Error(
      code === 1 ? 'Location permission was denied. Allow precise location for Handoff in your phone settings, then try again.'
      : code === 3 ? 'Getting a location fix took too long. Move into open sky and capture again.'
      : 'Location was not captured. Turn on precise location and try again.',
    );
  }
}
