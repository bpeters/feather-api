import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import twilio from 'twilio';

admin.initializeApp();

const client = new twilio(functions.config().twilio.accountSid, functions.config().twilio.authToken);

export const handleSMS = functions.https.onRequest(async (req, res) => {
  try {
    console.log(req.body);

    res.send();
  } catch (error) {
    console.log('Error', error);

    res.end();
  }
});