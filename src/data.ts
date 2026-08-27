import type { Agent, AppNotification, CustodyRecord, RecoveryCase } from './types';

export const agents: Agent[] = [
  { id: 'agent-1', name: 'Ravi Kumar', mobile: '+91 98451 22014', city: 'Bengaluru', activeCases: 4, completedThisMonth: 12, status: 'Active' },
  { id: 'agent-2', name: 'Ayesha Shaikh', mobile: '+91 99018 45107', city: 'Bengaluru', activeCases: 3, completedThisMonth: 9, status: 'Active' },
  { id: 'agent-3', name: 'Naveen Reddy', mobile: '+91 97319 00682', city: 'Mysuru', activeCases: 2, completedThisMonth: 7, status: 'Active' },
  { id: 'agent-4', name: 'Harish Patel', mobile: '+91 98860 77384', city: 'Tumakuru', activeCases: 0, completedThisMonth: 4, status: 'Suspended' },
];

export const recoveryCases: RecoveryCase[] = [
  { id: 'RC-260801', accountNumber: 'LN-801449', borrower: { name: 'Meera Iyer', mobile: '+91 98450 21736', address: '4th Cross, HSR Layout, Bengaluru' }, vehicle: { registration: 'KA 01 MQ 4281', makeModel: '2023 Honda Activa 6G', chassis: 'ME4JF90A6P8A04421', type: '2-wheeler' }, branch: 'HSR Layout', pendingAmount: 38400, overdueDays: 97, status: 'Assigned', assignedAgentId: 'agent-1', assignedAt: 'Today, 09:12', updatedAt: '12 min ago' },
  { id: 'RC-260798', accountNumber: 'LN-801402', borrower: { name: 'Arjun Nair', mobile: '+91 99801 76423', address: '2nd Main, Vijayanagar, Bengaluru' }, vehicle: { registration: 'KA 02 HK 9024', makeModel: '2022 Tata Nexon XZ+', chassis: 'MAT626404NWB40168', type: '4-wheeler' }, branch: 'Vijayanagar', pendingAmount: 178250, overdueDays: 124, status: 'Attempt in progress', assignedAgentId: 'agent-2', assignedAt: 'Yesterday, 17:40', updatedAt: '28 min ago' },
  { id: 'RC-260792', accountNumber: 'LN-801356', borrower: { name: 'Shashank Rao', mobile: '+91 99000 88921', address: 'JP Nagar Phase 7, Bengaluru' }, vehicle: { registration: 'KA 05 JJ 6810', makeModel: '2021 TVS Apache RTR 160', chassis: 'MD634KE47M2B59138', type: '2-wheeler' }, branch: 'JP Nagar', pendingAmount: 24600, overdueDays: 88, status: 'Unable to recover', assignedAgentId: 'agent-1', updatedAt: '1 hr ago', failure: { reason: 'Vehicle not found', note: 'Address verified. Neighbours have not seen the vehicle for three days.', recordedAt: 'Today, 10:05' } },
  { id: 'RC-260787', accountNumber: 'LN-801309', borrower: { name: 'Kavya Menon', mobile: '+91 98442 36157', address: 'Indiranagar 100 Ft Road, Bengaluru' }, vehicle: { registration: 'KA 03 PN 4125', makeModel: '2020 Hyundai Venue SX', chassis: 'MALPC813LLM207452', type: '4-wheeler' }, branch: 'Indiranagar', pendingAmount: 121900, overdueDays: 113, status: 'Payment pending', assignedAgentId: 'agent-3', updatedAt: 'Yesterday', custodyId: 'CT-260078' },
  { id: 'RC-260780', accountNumber: 'LN-801250', borrower: { name: 'Rohit Kulkarni', mobile: '+91 97408 05513', address: 'Yelahanka New Town, Bengaluru' }, vehicle: { registration: 'KA 04 SB 7789', makeModel: '2021 Royal Enfield Classic 350', chassis: 'ME3U3S5C2M1D80128', type: '2-wheeler' }, branch: 'Yelahanka', pendingAmount: 42750, overdueDays: 64, status: 'Imported', updatedAt: 'Yesterday' },
  { id: 'RC-260774', accountNumber: 'LN-801184', borrower: { name: 'Farah Ali', mobile: '+91 99867 42018', address: 'Kengeri Satellite Town, Bengaluru' }, vehicle: { registration: 'KA 41 Q 1146', makeModel: '2022 Suzuki Access 125', chassis: 'MB8DP11A3P8F92174', type: '2-wheeler' }, branch: 'Kengeri', pendingAmount: 31200, overdueDays: 73, status: 'Custody certificate issued', assignedAgentId: 'agent-2', updatedAt: 'Aug 5', custodyId: 'CT-260077' },
];

export const custodyRecords: CustodyRecord[] = [
  { id: 'CT-260078', caseId: 'RC-260787', vehicleCondition: 'Verified', yardName: 'Sri Lakshmi Parking, Yeshwanthpur', arrivalTime: 'Aug 05, 18:25', parkingRate: 350, createdAt: 'Aug 05, 18:41', agentName: 'Naveen Reddy', checklist: 14 },
  { id: 'CT-260077', caseId: 'RC-260774', vehicleCondition: 'Verified', yardName: 'Sri Lakshmi Parking, Yeshwanthpur', arrivalTime: 'Aug 05, 15:18', parkingRate: 350, createdAt: 'Aug 05, 15:32', agentName: 'Ayesha Shaikh', checklist: 14 },
  { id: 'CT-260071', caseId: 'RC-260742', vehicleCondition: 'Verified', yardName: 'Krishna Vehicle Yard, Peenya', arrivalTime: 'Aug 03, 13:05', parkingRate: 300, createdAt: 'Aug 03, 13:20', agentName: 'Ravi Kumar', checklist: 14 },
];

export const notifications: AppNotification[] = [
  { id: 'n-1', title: 'Custody report submitted', detail: 'RC-260787 was submitted by Naveen Reddy and is awaiting your review.', createdAt: '18 min ago', read: false, tone: 'green' },
  { id: 'n-2', title: 'Recovery attempt could not be completed', detail: 'RC-260792 was marked Vehicle not found with a field note.', createdAt: '1 hr ago', read: false, tone: 'amber' },
  { id: 'n-3', title: 'New case assigned', detail: 'RC-260801 was assigned to Ravi Kumar.', createdAt: '2 hrs ago', read: true, tone: 'blue' },
];
