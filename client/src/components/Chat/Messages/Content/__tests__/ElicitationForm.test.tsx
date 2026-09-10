import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ElicitationForm from '../ElicitationForm';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));

const request = {
  message: 'Choose a city',
  requestedSchema: {
    type: 'object' as const,
    properties: { city: { type: 'string' as const, title: 'City', default: 'Paris' } },
    required: ['city'],
  },
};

it('keeps the form disabled until the answer is acknowledged', async () => {
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const accept = jest.fn(() => pending);
  render(
    <ElicitationForm
      request={request}
      serverName="forms"
      onAccept={accept}
      onDecline={() => {}}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_accept' }));
  await waitFor(() => expect(accept).toHaveBeenCalledWith({ city: 'Paris' }));
  expect(screen.getByRole('button', { name: 'com_ui_submit' })).toBeDisabled();
  await act(async () => {
    finish();
  });
  expect(screen.getByRole('button', { name: 'com_ui_accept' })).toBeEnabled();
});

it('keeps the answer available for retry when submission fails', async () => {
  render(
    <ElicitationForm
      request={request}
      serverName="forms"
      onAccept={async () => {
        throw new Error('offline');
      }}
      onDecline={() => {}}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_accept' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('com_ui_approval_error');
  expect(screen.getByRole('textbox', { name: /City/ })).toHaveValue('Paris');
  expect(screen.getByRole('button', { name: 'com_ui_accept' })).toBeEnabled();
});
