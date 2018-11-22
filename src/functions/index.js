import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import twilio from 'twilio';

admin.initializeApp();

const db = admin.firestore();

db.settings({
  timestampsInSnapshots: true,
});

const twilioClient = new twilio(functions.config().twilio.accountsid, functions.config().twilio.authtoken);

export const handleSMS = functions.https.onRequest(async (req, res) => {
  try {
    const sentFrom = req.body.From;
    const sentMessage = req.body.Body;

    const guides = await db.collection('guides').where('phone', '==', sentFrom).limit(1).get();

    let guide;

    guides.forEach((doc) => {
      guide = {
        id: doc.id,
        ...doc.data(),
      };
    });

    if (!guide) {
      const sessions = await db.collection('sessions').where('patient', '==', sentFrom).limit(1).get();

      let session;

      sessions.forEach((doc) => {
        session = {
          id: doc.id,
          ...doc.data(),
        };
      });

      if (!session) {
        const sessionRef = db.collection('sessions').doc();

        await sessionRef.set({
          started: admin.firestore.FieldValue.serverTimestamp(),
          patient: sentFrom,
          messages: [{
            from: sentFrom,
            message: sentMessage,
          }],
          connected: true,
        });

        await twilioClient.messages.create({
          body: 'Connecting you to a guide now...',
          to: sentFrom,
          from: functions.config().twilio.phone,
        });

        const newGuides = await db.collection('guides').where('connected', '==', false).limit(1).get();

        let guideRef;

        newGuides.forEach((doc) => {
          guideRef = db.collection('guides').doc(doc.id);
        });

        if (!guideRef) {
          await sessionRef.update({
            connected: false,
          });

          // this should trigger a timer to check for new guides
        } else {
          await guideRef.update({
            connected: true,
            session: sessionRef.id,
          });

          const guideDoc = (await guideRef.get()).data();

          await twilioClient.messages.create({
            body: `You are being connected to a new patient. You can end the session anytime by texting DONE`,
            to: guideDoc.phone,
            from: functions.config().twilio.phone,
          });

          await twilioClient.messages.create({
            body: `Patient: ${sentMessage}`,
            to: guideDoc.phone,
            from: functions.config().twilio.phone,
          });

          await sessionRef.update({
            guide: guideDoc.phone,
          });

          await twilioClient.messages.create({
            body: `You are now connected with ${guideDoc.name}. You can end the session anytime by texting DONE`,
            to: sentFrom,
            from: functions.config().twilio.phone,
          });
        }

      } else if (!session.connected) {
        const sessionRef = db.collection('sessions').doc(session.id);

        session.messages.push({
          from: sentFrom,
          message: sentMessage,
        });

        await sessionRef.update({
          messages: session.messages,
        });
      } else {
        const sessionRef = db.collection('sessions').doc(session.id);

        if (sentMessage.toLowerCase() === 'done') {
          await sessionRef.delete();

          const currentGuides = await db.collection('guides').where('session', '==', session.id).limit(1).get();

          let guideRef;

          currentGuides.forEach((doc) => {
            guideRef = db.collection('guides').doc(doc.id);
          });

          await guideRef.update({
            connected: false,
            session: admin.firestore.FieldValue.delete(),
          });

          await twilioClient.messages.create({
            body: 'You have ended your session. To start a new session just text this number anytime.',
            to: sentFrom,
            from: functions.config().twilio.phone,
          });

          await twilioClient.messages.create({
            body: 'The patient has ended the session.',
            to: session.guide,
            from: functions.config().twilio.phone,
          });
        } else {
          session.messages.push({
            from: sentFrom,
            message: sentMessage,
          });

          await sessionRef.update({
            messages: session.messages,
          });

          await twilioClient.messages.create({
            body: `Patient: ${sentMessage}`,
            to: session.guide,
            from: functions.config().twilio.phone,
          });
        }
      }

    } else if (guide.connected) {
      const sessionRef = db.collection('sessions').doc(guide.session);
      const session = (await sessionRef.get()).data();

      if (sentMessage.toLowerCase() === 'done') {
        await sessionRef.delete();

        const guideRef = db.collection('guides').doc(guide.id);

        await guideRef.update({
          connected: false,
          session: admin.firestore.FieldValue.delete(),
        });

        await twilioClient.messages.create({
          body: 'You have ended the session.',
          to: sentFrom,
          from: functions.config().twilio.phone,
        });

        await twilioClient.messages.create({
          body: 'The guide has ended the session. To start a new session just text this number anytime.',
          to: session.patient,
          from: functions.config().twilio.phone,
        });
      } else {
        session.messages.push({
          from: sentFrom,
          message: sentMessage,
        });

        await sessionRef.update({
          messages: session.messages,
        });

        await twilioClient.messages.create({
          body: `${guide.name}: ${sentMessage}`,
          to: session.patient,
          from: functions.config().twilio.phone,
        });
      }
    }

    res.send();
  } catch (error) {
    console.log('Error', error);

    res.end();
  }
});