import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MessageDocument, PeerDocument, useDittoContext } from '../context/DittoContext';

const carTypeIcons: Record<string, string> = {
  Sedan: '🚗',
  SUV: '🚙',
  Truck: '🚚',
  Coupe: '🏎️',
};

const getCarIcon = (carType: string): string => carTypeIcons[carType] ?? '🚘';

export const RadarScreen = () => {
  const { ditto, nearbyUsers, localPeerId } = useDittoContext();
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState<MessageDocument[]>([]);

  useEffect(() => {
    if (!ditto) {
      return;
    }

    const messagesObserver = ditto.store
      .collection<MessageDocument>('messages')
      .find()
      .subscribe()
      .observe((incomingMessages) => {
        setMessages(incomingMessages.sort((a, b) => b.timestamp - a.timestamp));
      });

    return () => {
      messagesObserver.cancel();
    };
  }, [ditto]);

  const sendToAll = async () => {
    if (!ditto || messageInput.trim().length === 0 || !localPeerId) {
      return;
    }

    await ditto.store.collection<MessageDocument>('messages').upsert({
      text: messageInput,
      timestamp: Date.now(),
      senderId: localPeerId,
    });

    setMessageInput('');
  };

  const renderUser = ({ item }: { item: PeerDocument }) => {
    const icon = getCarIcon(item.carType);

    return (
      <View style={styles.card}>
        <Text style={styles.username}>{item.username}</Text>
        <Text style={[styles.carIcon, { color: item.carColor }]}>{icon}</Text>
        <Text style={styles.subText}>{item.carType}</Text>
      </View>
    );
  };

  const renderMessage = ({ item }: { item: MessageDocument }) => (
    <View style={styles.messageRow}>
      <Text style={styles.messageText}>{item.text}</Text>
      <Text
        style={styles.messageMeta}
        accessibilityLabel={`Message sent at ${new Date(item.timestamp).toLocaleTimeString()} by ${item.senderId}`}
      >
        {new Date(item.timestamp).toLocaleTimeString()} • {item.senderId}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Nearby Drivers</Text>
        <FlatList
          data={nearbyUsers}
          keyExtractor={(item) => item._id}
          renderItem={renderUser}
          contentContainerStyle={styles.listContent}
        />

        <View style={styles.broadcastSection}>
          <Text style={styles.sectionTitle}>Broadcast Message</Text>
          <TextInput
            value={messageInput}
            onChangeText={setMessageInput}
            placeholder="Type a message"
            style={styles.input}
          />
          <TouchableOpacity style={styles.button} onPress={() => { void sendToAll(); }}>
            <Text style={styles.buttonText}>Send to All</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.messageLogSection}>
          <Text style={styles.sectionTitle}>Live Message Log</Text>
          <FlatList
            data={messages}
            keyExtractor={(item) => item._id}
            renderItem={renderMessage}
            contentContainerStyle={styles.listContent}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B1220',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  title: {
    color: '#F9FAFB',
    fontSize: 22,
    fontWeight: '700',
  },
  listContent: {
    gap: 8,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  username: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  carIcon: {
    fontSize: 24,
  },
  subText: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  broadcastSection: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  messageLogSection: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  sectionTitle: {
    color: '#E5E7EB',
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    color: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  button: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  messageRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#374151',
    paddingBottom: 6,
  },
  messageText: {
    color: '#F9FAFB',
    fontSize: 14,
  },
  messageMeta: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 2,
  },
});
