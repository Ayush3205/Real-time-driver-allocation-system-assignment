export const RedisKeys = {
  availableDriversGeo: () => 'drivers:geo:available',
  driverState: (driverId: string) => `driver:${driverId}:state`,
  driverAssignment: (driverId: string) => `driver:${driverId}:assignment`,
  rideState: (rideId: string) => `ride:${rideId}:state`,
  rideActiveOffers: (rideId: string) => `ride:${rideId}:active-offers`,
  rideNotifiedDrivers: (rideId: string) => `ride:${rideId}:notified-drivers`,
  rideAcceptances: (rideId: string) => `ride:${rideId}:acceptances`,
  rideAllocationLock: (rideId: string) => `ride:${rideId}:allocation-lock`,
};
