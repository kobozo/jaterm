# Helper Consent Modal Test Plan

## Feature Overview
The helper consent modal asks for user permission before deploying the jaterm-helper to remote SSH machines. This addresses GitHub Issue #4.

## Implementation Summary
- Added `helperConsent` field to SSH profiles and folder settings
- Created `HelperConsentModal` component with wiki link
- Implemented consent inheritance from folders to profiles
- Added consent checkboxes in profile/folder edit modals

## Test Cases

### 1. New SSH Profile - First Time Connection
**Steps:**
1. Create a new SSH profile without setting helper consent
2. Open the profile to connect
3. Verify consent modal appears

**Expected:**
- Modal displays with profile name and host
- Wiki link opens correctly (https://github.com/kobozo/jaterm/wiki)
- "Allow & Deploy" saves consent as "yes" and deploys helper
- "Don't Deploy" saves consent as "no" and skips helper deployment
- Cancel button closes modal without saving

### 2. SSH Profile with Pre-set Consent
**Steps:**
1. Create/edit SSH profile with "Deploy helper" checkbox checked
2. Open the profile to connect

**Expected:**
- No consent modal appears
- Helper deploys automatically
- Consent setting persists across sessions

### 3. Folder Consent Inheritance
**Steps:**
1. Create folder with "Deploy helper" checked
2. Add SSH profile to folder (without explicit consent set)
3. Open the profile

**Expected:**
- No consent modal (inherits from folder)
- Helper deploys based on folder setting

### 4. Profile Override of Folder Consent
**Steps:**
1. Create folder with "Deploy helper" checked
2. Add profile with "Deploy helper" unchecked
3. Open the profile

**Expected:**
- Profile setting overrides folder setting
- No helper deployment

### 5. Multiple Profiles - Consent Memory
**Steps:**
1. Open profile A - grant consent
2. Close and reopen profile A
3. Open profile B (different host)

**Expected:**
- Profile A: No modal on second open
- Profile B: Modal appears (separate consent per profile)

## Files Modified

### Frontend
- `/src/App.tsx` - Added consent resolution logic and modal state
- `/src/components/HelperConsentModal.tsx` - New consent modal component
- `/src/components/sessions.tsx` - Added consent checkboxes to edit modals
- `/src/store/persist.ts` - Added helperConsent field to data structures
- `/src/services/helper.ts` - Updated helper deployment logic

### Backend
- `/src-tauri/src/commands/ssh.rs` - Optimized SSH write performance (separate fix)

## Known Issues
- TypeScript compilation shows type errors (pre-existing, not related to this feature)
- Development build takes longer to compile (normal Rust compilation time)

## Status
✅ Implementation complete
✅ Rust backend compiles successfully
✅ Ready for production build testing