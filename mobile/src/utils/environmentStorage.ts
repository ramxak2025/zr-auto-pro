import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEnvironmentStorage } from './environmentStorageAdapter';
import { environmentStoragePrefix } from './runtimeEnvironment';

export default createEnvironmentStorage(AsyncStorage, environmentStoragePrefix);
