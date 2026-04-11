/**
 * Save a contact to the phone's native contact list using expo-contacts.
 */

import * as Contacts from 'expo-contacts';
import { Platform } from 'react-native';

export async function saveToNativeContacts(person: {
  name: string;
  phone?: string;
  email?: string;
}): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  try {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      console.log('[NativeContacts] Permission denied');
      return false;
    }

    const contact: Contacts.Contact = {
      contactType: Contacts.ContactTypes.Person,
      name: person.name,
      firstName: person.name.split(' ')[0],
      lastName: person.name.split(' ').slice(1).join(' ') || undefined,
    };

    if (person.phone) {
      contact.phoneNumbers = [{
        number: person.phone,
        label: 'mobile',
      }];
    }

    if (person.email) {
      contact.emails = [{
        email: person.email,
        label: 'home',
      }];
    }

    const contactId = await Contacts.addContactAsync(contact);
    console.log('[NativeContacts] Saved:', person.name, 'id:', contactId);
    return true;
  } catch (err) {
    console.error('[NativeContacts] Failed to save:', err);
    return false;
  }
}
