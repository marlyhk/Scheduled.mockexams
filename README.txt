SCHEDULED MOCK EXAMS v1.0
==========================

This is a separate website from Scheduled.
It uses the same Firebase project, visual design, static deployment structure, and Firebase Authentication system as the uploaded Scheduled v9.14 website.

NO SUPABASE, VITE, DATABASE ACCOUNT, OR ENVIRONMENT VARIABLES ARE REQUIRED.

ADMIN ACCESS
------------
Configured admin number: +961 76 174 738

Open the deployed website and tap "Admin access" or add #admin to the link.
On the very first admin login, enter the configured admin number and choose a password of at least 6 characters.
That password becomes the permanent Mock Exams admin password.
Afterward, the same number/password can log in repeatedly.

FIRST USE
---------
1. Deploy this folder exactly the same way as your Scheduled website.
2. Open: YOUR-WEBSITE-LINK/#admin
3. Log in using +96176174738 and choose your admin password on first login.
4. Create a mock exam.
5. Set title, course, duration, available-from date/time, available-until date/time, submission countdown, and status.
6. Upload the PDF and save.
7. Open Students & Access, select the exam, and add each student's name and number starting with 961.
8. Mark the student Paid.
9. Generate their individual one-time password.
10. Press WhatsApp to send the exam link, phone number, password, duration, and dates.

STUDENT FLOW
------------
- Student opens the exam-specific link sent through WhatsApp.
- Student enters full name, registered phone number starting with 961, and individual password.
- Access is checked by phone number + password; the typed name does not control access.
- Student sees the confirmation screen and presses Start Now.
- The individual timer begins.
- The original password is invalidated after starting.
- Refreshing continues the same timer.
- The attempt is locked to the first device that starts it.
- The PDF is rendered as canvas pages with the student's name, number, exam code, and start time watermarked on every page.
- When time ends or the student finishes early, the exam is hidden and the same WhatsApp submission screen appears.
- A five-minute countdown begins and Send Answers on WhatsApp opens the configured admin chat.

ADMIN FEATURES
--------------
- Multiple mock exams
- PDF upload
- Editable duration
- Availability start and deadline
- Active/Hidden status
- Paid/Unpaid students
- Allow/Block access
- Unique one-time password generation
- Prefilled WhatsApp access message
- Live attempts panel
- Started/ending/finished times
- Active, Finished Early, Time Ended, and Blocked statuses
- Device lock information
- Tab-switch counter
- Add or remove minutes from an active attempt
- End an active attempt
- Change admin password
- Change answer-submission WhatsApp number

DEPLOYMENT
----------
Use the same method as Scheduled:

VERCEL
1. Unzip this file.
2. Create a new Vercel project for this separate website.
3. Upload/import these files.
4. Deploy.

The package.json build creates the public folder exactly like Scheduled.
No Firebase configuration is needed because this project already uses the same Firebase settings as Scheduled.

IMPORTANT
---------
Do not change the Firebase configuration in app.js unless the Scheduled Firebase project itself changes.
All Mock Exams data is kept under the separate database path:
mockExamAppV1

The normal Scheduled interface and its existing data paths are not modified by this website.
