import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DittoProvider } from './src/context/DittoContext';
import { RadarScreen } from './src/screens/RadarScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <DittoProvider>
        <RadarScreen />
        <StatusBar style="light" />
      </DittoProvider>
    </SafeAreaProvider>
  );
}
