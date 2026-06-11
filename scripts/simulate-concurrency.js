const rawBaseUrl = process.argv[2] || 'http://localhost:3000';
const baseUrl = rawBaseUrl.replace(/\/$/, '');
const driverCount = Number(process.argv[3] || 8);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function http(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = body?.message || response.statusText;
    throw new Error(`${options.method || 'GET'} ${path} failed: ${message}`);
  }

  return body;
}

async function pollOffers(rideId) {
  for (let index = 0; index < 20; index += 1) {
    const offers = await http(`/rides/${rideId}/offers`);
    const activeOffers = offers.filter((offer) => offer.status === 'OFFERED');
    if (activeOffers.length > 0) {
      return activeOffers;
    }

    await sleep(250);
  }

  return [];
}

async function run() {
  await http('/health');

  const pickup = { lat: 28.6139, lng: 77.209 };
  const createdDrivers = [];

  for (let index = 0; index < driverCount; index += 1) {
    const offset = index * 0.001;
    const driver = await http('/drivers', {
      method: 'POST',
      body: JSON.stringify({
        name: `Concurrency Driver ${Date.now()}-${index}`,
        lat: pickup.lat + offset,
        lng: pickup.lng + offset,
        status: 'AVAILABLE',
      }),
    });

    createdDrivers.push(driver);
  }

  const ride = await http('/rides', {
    method: 'POST',
    body: JSON.stringify({
      riderId: `rider-${Date.now()}`,
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
    }),
  });

  const offers = await pollOffers(ride.id);
  if (!offers.length) {
    throw new Error('No active offers were created. Check Redis GEO data and allocation settings.');
  }

  const driverIds = offers.map((offer) => offer.driverId);
  const duplicatedAccepts = driverIds.flatMap((driverId) => [driverId, driverId]);

  const responses = await Promise.all(
    duplicatedAccepts.map((driverId) =>
      http(`/rides/${ride.id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ driverId }),
      }).catch((error) => ({ error: error.message, driverId })),
    ),
  );

  const finalRide = await http(`/rides/${ride.id}`);
  const summary = responses.reduce((acc, response) => {
    const key = response.code || 'ERROR';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log('Created drivers:', createdDrivers.length);
  console.log('Ride:', ride.id);
  console.log('Offered drivers:', driverIds);
  console.log('Acceptance summary:', summary);
  console.log('Assigned driver:', finalRide.assignedDriverId);
  console.log('Final state:', finalRide.state);
  console.log('Responses:');
  console.table(responses.map(({ rideId, driverId, accepted, code, assignedDriverId, state, error }) => ({
    rideId,
    driverId,
    accepted,
    code,
    assignedDriverId,
    state,
    error,
  })));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
