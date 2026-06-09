import { Authenticator, Ditto, DittoConfig, Observer, StoreObserver, SyncSubscription, init } from '@dittolive/ditto';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type DittoIdentity = 'onlinePlayground' | 'development';

const DITTO_IDENTITY_CONFIG: Record<DittoIdentity, { appId: string; token: string }> = {
  onlinePlayground: {
    appId: process.env.EXPO_PUBLIC_DITTO_ONLINE_PLAYGROUND_APP_ID ?? '',
    token: process.env.EXPO_PUBLIC_DITTO_ONLINE_PLAYGROUND_TOKEN ?? '',
  },
  development: {
    appId: process.env.EXPO_PUBLIC_DITTO_DEVELOPMENT_APP_ID ?? '',
    token: process.env.EXPO_PUBLIC_DITTO_DEVELOPMENT_TOKEN ?? '',
  },
};
const ONLINE_PLAYGROUND_URL = 'https://playground.ditto.live';
const ONLINE_PLAYGROUND_AUTH_PROVIDER = process.env.EXPO_PUBLIC_DITTO_ONLINE_PLAYGROUND_AUTH_PROVIDER ?? String(Authenticator.DEVELOPMENT_PROVIDER);
const PRESENCE_HEARTBEAT_MS = Number(process.env.EXPO_PUBLIC_PRESENCE_HEARTBEAT_MS ?? '30000');
const LOCAL_PEER_ID_KEY = 'merge.localPeerId';

export type PeerDocument = {
  _id: string;
  username: string;
  carType: string;
  carColor: string;
  lastSeen: number;
};

export type MessageDocument = {
  _id: string;
  text: string;
  timestamp: number;
  senderId: string;
};

type QueryObserver = {
  cancel: () => void;
};

type QuerySubscription<T> = {
  observe: (handler: (items: T[]) => void) => QueryObserver;
};

type CollectionAdapter<T extends { _id: string }> = {
  find: (query?: string) => {
    subscribe: () => QuerySubscription<T>;
  };
  upsert: (document: Omit<T, '_id'> & { _id?: string }) => Promise<void>;
};

type DittoStoreAdapter = {
  collection: <T extends { _id: string }>(name: string) => CollectionAdapter<T>;
};

type DittoApp = {
  raw: Ditto;
  localId: string;
  startSync: () => void;
  store: DittoStoreAdapter;
};

type DittoContextValue = {
  ditto: DittoApp | null;
  nearbyUsers: PeerDocument[];
  localPeerId: string;
  username: string;
  setUsername: (value: string) => void;
  carType: string;
  setCarType: (value: string) => void;
  carColor: string;
  setCarColor: (value: string) => void;
};

const DittoContext = createContext<DittoContextValue | undefined>(undefined);

const randomId = (): string => {
  const random = Math.floor(Math.random() * 1_000_000_000).toString(36);
  return `${Date.now().toString(36)}-${random}`;
};

const loadOrCreateLocalId = async (): Promise<string> => {
  const existing = await SecureStore.getItemAsync(LOCAL_PEER_ID_KEY);

  if (existing) {
    return existing;
  }

  const generated = randomId();
  await SecureStore.setItemAsync(LOCAL_PEER_ID_KEY, generated);
  return generated;
};

const normalizeQuery = (collectionName: string, query?: string, localId?: string): { query: string; args?: Record<string, string> } => {
  if (query === '!isSelf' && localId) {
    return {
      query: `SELECT * FROM ${collectionName} WHERE _id != :selfId`,
      args: { selfId: localId },
    };
  }

  if (!query || query.trim().length === 0) {
    return { query: `SELECT * FROM ${collectionName}` };
  }

  return { query: `SELECT * FROM ${collectionName} WHERE ${query}` };
};

const createStoreAdapter = (ditto: Ditto, localId: string): DittoStoreAdapter => ({
  collection: <T extends { _id: string }>(name: string): CollectionAdapter<T> => ({
    find: (query?: string) => {
      const normalized = normalizeQuery(name, query, localId);

      return {
        subscribe: (): QuerySubscription<T> => {
          const syncSubscription: SyncSubscription = ditto.sync.registerSubscription(normalized.query, normalized.args);

          return {
            observe: (handler: (items: T[]) => void): QueryObserver => {
              const storeObserver: StoreObserver = ditto.store.registerObserver<T>(normalized.query, (result) => {
                handler(result.items.map((item) => item.value as T));
              }, normalized.args);

              return {
                cancel: () => {
                  storeObserver.cancel();
                  syncSubscription.cancel();
                },
              };
            },
          };
        },
      };
    },
    upsert: async (document: Omit<T, '_id'> & { _id?: string }) => {
      const upsertDocument = {
        ...document,
        _id: document._id ?? randomId(),
      };

      await ditto.store.execute(`INSERT INTO ${name} DOCUMENTS (:doc) ON ID CONFLICT DO UPDATE`, {
        doc: upsertDocument,
      });
    },
  }),
});

let dittoInstancePromise: Promise<DittoApp> | null = null;

export const initDitto = (identity: DittoIdentity = 'development'): Promise<DittoApp> => {
  if (dittoInstancePromise) {
    return dittoInstancePromise;
  }

  dittoInstancePromise = (async () => {
    await init();

    const localId = await loadOrCreateLocalId();
    const identityConfig = DITTO_IDENTITY_CONFIG[identity];
    const appId = identityConfig.appId;

    if (!appId) {
      throw new Error(`Missing Ditto appId for identity: ${identity}`);
    }

    const config = new DittoConfig(
      appId,
      identity === 'onlinePlayground'
        ? { mode: 'server', url: ONLINE_PLAYGROUND_URL }
        : { mode: 'smallPeersOnly' },
    );

    const raw = await Ditto.open(config);

    raw.updateTransportConfig((transportConfig) => {
      transportConfig.setAvailablePeerToPeerEnabled(true);
    });

    if (identity === 'onlinePlayground') {
      if (!identityConfig.token) {
        throw new Error('Missing Ditto online playground token');
      }

      await raw.auth.setExpirationHandler(async (ditto) => {
        await ditto.auth.login(identityConfig.token, ONLINE_PLAYGROUND_AUTH_PROVIDER);
      });
    }

    const store = createStoreAdapter(raw, localId);

    return {
      raw,
      localId,
      startSync: () => {
        raw.sync.start();
      },
      store,
    };
  })();

  return dittoInstancePromise;
};

export const DittoProvider = ({ children }: { children: React.ReactNode }) => {
  const [ditto, setDitto] = useState<DittoApp | null>(null);
  const [nearbyUsers, setNearbyUsers] = useState<PeerDocument[]>([]);
  const [username, setUsername] = useState('Driver');
  const [carType, setCarType] = useState('Sedan');
  const [carColor, setCarColor] = useState('#3B82F6');

  useEffect(() => {
    let isMounted = true;

    const setup = async () => {
      const instance = await initDitto('development');

      if (isMounted) {
        setDitto(instance);
      }
    };

    void setup();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ditto) {
      return;
    }

    ditto.startSync();

    const usersObserver = ditto.store
      .collection<PeerDocument>('peers')
      .find('!isSelf')
      .subscribe()
      .observe((users) => {
        setNearbyUsers(users.sort((a, b) => b.lastSeen - a.lastSeen));
      });

    const upsertSelf = async () => {
      await ditto.store.collection<PeerDocument>('peers').upsert({
        _id: ditto.localId,
        username,
        carType,
        carColor,
        lastSeen: Date.now(),
      });
    };

    void upsertSelf();
    const heartbeat = setInterval(() => {
      void upsertSelf();
    }, PRESENCE_HEARTBEAT_MS);

    return () => {
      clearInterval(heartbeat);
      usersObserver.cancel();
    };
  }, [carColor, carType, ditto, username]);

  const value = useMemo<DittoContextValue>(() => ({
    ditto,
    nearbyUsers,
    localPeerId: ditto?.localId ?? '',
    username,
    setUsername,
    carType,
    setCarType,
    carColor,
    setCarColor,
  }), [carColor, carType, ditto, nearbyUsers, username]);

  return <DittoContext.Provider value={value}>{children}</DittoContext.Provider>;
};

export const useDittoContext = (): DittoContextValue => {
  const context = useContext(DittoContext);

  if (!context) {
    throw new Error('useDittoContext must be used within DittoProvider');
  }

  return context;
};
